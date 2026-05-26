import type { Catalogue, Form, Line } from "./types.js";
import { walkLines } from "./normalize.js";
import { renderHelpBody } from "./help_tree.js";

/**
 * Lightweight scored substring search. The corpus is short (≈ 30 forms × a
 * few hundred lines per year), so a naive but well-weighted match is good
 * enough and produces stable, explainable rankings.
 *
 * Rules:
 *   - Tokenize the query into lowercase non-empty words on Unicode-letter
 *     boundaries. Stopwords are NOT removed — German tax terms include short
 *     words ("im", "der") that can matter for disambiguation.
 *   - Each token contributes a score based on where it matches:
 *     * exact whole-word hit in the label → 10
 *     * substring hit in the label        → 5
 *     * hit in the section_label          → 2
 *     * hit in the page_label             → 1
 *   - Sum, then divide by sqrt(tokens.length) to keep long queries from
 *     overwhelming short labels.
 *
 * The result is deterministic and easy to reason about — no hidden BM25
 * tuning surprises. Drop a BM25 in later if quality demands it.
 */

export interface LineHit {
  form_slug: string;
  line_number: string;
  page_number: number;
  page_label: string;
  section_label: string | null;
  label: string;
  score: number;
}

export interface HelpHit {
  tax_type: string;
  year: string;
  help_source: string;
  heading_title: string;
  snippet: string;
  score: number;
}

export function tokenizeQuery(input: string): string[] {
  return input
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0);
}

export function searchLines(
  catalogue: Catalogue,
  taxType: string,
  year: string,
  query: string,
  options: { limit: number; formSlug?: string }
): LineHit[] {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return [];
  const limit = Math.min(Math.max(options.limit, 1), 50);

  const forms = collectFormsForYear(catalogue, taxType, year, options.formSlug);
  const hits: LineHit[] = [];
  for (const form of forms) {
    walkLines(form.pages, (line) => {
      if (line.line_number == null) return;
      const score = scoreLineMatch(tokens, line);
      if (score > 0) {
        hits.push({
          form_slug: form.slug,
          line_number: line.line_number,
          page_number: line.page_number,
          page_label: line.page_label,
          section_label: line.section_label,
          label: line.label,
          score,
        });
      }
    });
  }
  hits.sort((a, b) => b.score - a.score || a.form_slug.localeCompare(b.form_slug));
  return hits.slice(0, limit);
}

export function searchHelp(
  catalogue: Catalogue,
  taxType: string,
  year: string,
  query: string,
  options: { limit: number }
): HelpHit[] {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return [];
  const limit = Math.min(Math.max(options.limit, 1), 50);

  const helpFile = catalogue.helpFiles.get(`${taxType}/${year}`);
  if (!helpFile) return [];

  const hits: HelpHit[] = [];
  const lines = helpFile.source.split(/\r?\n/);

  const visit = (node: typeof helpFile.docRoot): void => {
    if (node !== helpFile.docRoot) {
      const bodyText = lines.slice(node.bodyLines.start, node.bodyLines.end).join("\n");
      const score = scoreHelpMatch(tokens, node.title, bodyText);
      if (score > 0) {
        hits.push({
          tax_type: taxType,
          year,
          help_source: `${helpFile.filename}#${node.anchor}`,
          heading_title: node.title,
          snippet: renderHelpBody(node, helpFile.source, { includeChildren: false }).slice(0, 600),
          score,
        });
      }
    }
    for (const c of node.children) visit(c);
  };
  visit(helpFile.docRoot);
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}

function collectFormsForYear(
  catalogue: Catalogue,
  taxType: string,
  year: string,
  formSlug?: string
): Form[] {
  const out: Form[] = [];
  for (const form of catalogue.forms.values()) {
    if (form.tax_type !== taxType || form.year !== year) continue;
    if (formSlug && form.slug !== formSlug) continue;
    out.push(form);
  }
  return out;
}

function scoreLineMatch(tokens: string[], line: Line): number {
  const label = line.label.toLowerCase();
  const sectionLabel = (line.section_label ?? "").toLowerCase();
  const pageLabel = line.page_label.toLowerCase();
  let raw = 0;
  for (const t of tokens) {
    if (wholeWordMatch(label, t)) raw += 10;
    else if (label.includes(t)) raw += 5;
    if (sectionLabel.includes(t)) raw += 2;
    if (pageLabel.includes(t)) raw += 1;
  }
  if (raw === 0) return 0;
  return raw / Math.sqrt(tokens.length);
}

function scoreHelpMatch(tokens: string[], heading: string, body: string): number {
  const h = heading.toLowerCase();
  const b = body.toLowerCase();
  let raw = 0;
  for (const t of tokens) {
    if (wholeWordMatch(h, t)) raw += 8;
    else if (h.includes(t)) raw += 4;
    if (b.includes(t)) raw += 1;
  }
  if (raw === 0) return 0;
  return raw / Math.sqrt(tokens.length);
}

function wholeWordMatch(haystack: string, needle: string): boolean {
  // Cheap word-boundary check: needle must be flanked by non-letter chars or
  // string boundaries. Avoids pulling in a regex per call.
  const idx = haystack.indexOf(needle);
  if (idx < 0) return false;
  const before = idx === 0 ? "" : haystack[idx - 1]!;
  const after = idx + needle.length === haystack.length ? "" : haystack[idx + needle.length]!;
  return !isLetterOrDigit(before) && !isLetterOrDigit(after);
}

function isLetterOrDigit(ch: string): boolean {
  return /^[\p{L}\p{N}]$/u.test(ch);
}

/**
 * Top-N Levenshtein-near neighbours from a pool of candidate strings. Used to
 * suggest near-misses on line-number typos, where the candidates are short
 * and the right answer is almost always a one-character edit away.
 *
 * For form-slug suggestions use `suggestForms` instead: form slugs and the
 * user's mental model of them diverge in non-Levenshtein ways (e.g. dropped
 * umlauts), so a richer signal is needed.
 */
export function nearestNeighbours(
  candidates: readonly string[],
  query: string,
  top: number
): string[] {
  const scored = candidates.map((c) => ({ c, d: levenshtein(c, query) }));
  scored.sort((a, b) => a.d - b.d || a.c.localeCompare(b.c));
  return scored
    .filter((s) => s.d <= Math.max(2, Math.floor(query.length / 3)))
    .slice(0, top)
    .map((s) => s.c);
}

/**
 * Suggest the top-N form slugs a user probably meant, given a misspelled
 * slug or a slug derived from a heading with characters that the upstream
 * slugify algorithm drops (notably umlauts).
 *
 * Combines three signals:
 *   1. Levenshtein closeness on the slug — typo recovery (`anlage-zv` → `anlage-zve`).
 *   2. Token overlap on the slug — input tokens that share or substring-match a
 *      candidate's hyphen-separated tokens (`anlage-öhk` → tokens `[anlage, hk]`
 *      → matches `anlage-hk-zur-spartentrennung`).
 *   3. Substring match on the human-readable display name — catches umlaut
 *      cases where the slug lost a glyph: `öhk` substring of "Anlage ÖHK …".
 *
 * Returns a deterministic top-N list, suggestions with score 0 are excluded.
 */
export function suggestForms(
  catalogue: { slug: string; name: string }[],
  query: string,
  top: number
): string[] {
  const qTokens = tokenizeFormName(query);
  const qSlugNormalized = normalizeForCompare(query);
  if (qTokens.length === 0) return [];

  const scored = catalogue.map((c) => {
    const cSlugNorm = normalizeForCompare(c.slug);
    const cSlugTokens = tokenizeFormName(c.slug);
    const cNameTokens = tokenizeFormName(c.name);

    let score = 0;

    // Token overlap on slug (each shared/substring-shared token contributes).
    for (const qt of qTokens) {
      for (const st of cSlugTokens) {
        if (st === qt) score += 6;
        else if (qt.length >= 2 && st.length >= 2 && (st.includes(qt) || qt.includes(st))) {
          score += 3;
        }
      }
    }

    // Substring/token match against the display name — the umlaut-recovery path.
    for (const qt of qTokens) {
      for (const nt of cNameTokens) {
        if (nt === qt) score += 5;
        else if (qt.length >= 2 && nt.length >= 2 && (nt.includes(qt) || qt.includes(nt))) {
          score += 2;
        }
      }
    }

    // Levenshtein bonus for close-typo cases.
    const lev = levenshtein(cSlugNorm, qSlugNormalized);
    const levThreshold = Math.max(2, Math.floor(qSlugNormalized.length / 3));
    if (lev <= levThreshold) score += levThreshold + 1 - lev;

    return { slug: c.slug, score };
  });

  scored.sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug));
  return scored
    .filter((s) => s.score > 0)
    .slice(0, top)
    .map((s) => s.slug);
}

/** Lower-case, replace any non-alphanumeric run with a single space, trim. */
function normalizeForCompare(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokenizeFormName(input: string): string[] {
  return normalizeForCompare(input)
    .split(" ")
    .filter((t) => t.length > 0);
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = new Array<number>(b.length + 1);
  let curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length]!;
}
