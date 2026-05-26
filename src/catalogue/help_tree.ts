import type { HelpHeadingNode } from "./types.js";
import { slugify } from "./slugify.js";

const HEADING_RE = /^(#{1,7})\s+(.+?)\s*$/;

/**
 * Parse a markdown document into a heading tree. Heading anchors are computed
 * relative to the implicit document root (the single top-level heading
 * wrapping the file, typically the H2 "Anleitung zur ..." title in ELSTER
 * help markdowns). This matches the anchor convention emitted by
 * `elster-forms-data/scripts/src/build_help_mapping.ts`.
 *
 * Bodies are stored as a `[start, end)` line range on each node:
 *   - `start` = the line directly after the heading (0-based).
 *   - `end`   = the line of the next sibling-or-shallower heading (exclusive),
 *               or the total line count when nothing follows.
 *
 * Render the body lazily with `renderHelpBody` so the parser stays O(N).
 */
export function parseHelpMarkdown(source: string): {
  root: HelpHeadingNode;
  docRoot: HelpHeadingNode;
} {
  const lines = source.split(/\r?\n/);
  const totalLines = lines.length;

  const root: HelpHeadingNode = {
    level: 0,
    title: "",
    anchor: "",
    bodyLines: { start: 0, end: totalLines },
    children: [],
    parent: null,
  };

  /** A flat list of every heading in document order, used for end-line backfill. */
  const flat: { node: HelpHeadingNode; lineIdx: number }[] = [];

  const stack: HelpHeadingNode[] = [root];
  let inFence = false;

  for (let i = 0; i < totalLines; i++) {
    const raw = lines[i] ?? "";
    if (raw.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = HEADING_RE.exec(raw);
    if (!m) continue;

    const level = m[1]!.length;
    const title = m[2]!.trim();

    while (stack.length > 1 && stack[stack.length - 1]!.level >= level) {
      stack.pop();
    }
    const parent = stack[stack.length - 1]!;
    const parentAnchor = parent.anchor;
    const ownSlug = slugify(title);
    const anchor = parentAnchor.length === 0 ? ownSlug : `${parentAnchor}/${ownSlug}`;
    const node: HelpHeadingNode = {
      level,
      title,
      anchor,
      bodyLines: { start: i + 1, end: totalLines },
      children: [],
      parent,
    };
    parent.children.push(node);
    stack.push(node);
    flat.push({ node, lineIdx: i });
  }

  // Backfill end-lines: each heading's body ends where the next-or-shallower
  // heading begins. Walking the flat list left-to-right is the simplest way.
  for (let i = 0; i < flat.length; i++) {
    const { node, lineIdx } = flat[i]!;
    let endLine = totalLines;
    for (let j = i + 1; j < flat.length; j++) {
      const next = flat[j]!;
      if (next.node.level <= node.level) {
        endLine = next.lineIdx;
        break;
      }
    }
    node.bodyLines = { start: lineIdx + 1, end: endLine };
  }

  const docRoot = pickDocRoot(root);
  if (docRoot !== root) reanchorRelativeTo(docRoot);

  return { root, docRoot };
}

function pickDocRoot(root: HelpHeadingNode): HelpHeadingNode {
  return root.children.length === 1 ? root.children[0]! : root;
}

function reanchorRelativeTo(newRoot: HelpHeadingNode): void {
  const prefix = newRoot.anchor;
  const walk = (node: HelpHeadingNode): void => {
    if (node === newRoot) {
      node.anchor = "";
    } else if (prefix.length > 0 && node.anchor.startsWith(`${prefix}/`)) {
      node.anchor = node.anchor.slice(prefix.length + 1);
    }
    for (const c of node.children) walk(c);
  };
  walk(newRoot);
}

/**
 * Resolve an anchor (the part after `#` in `help_source`) to its heading
 * node. Anchors are paths joined with `/`, relative to the document root
 * returned by `parseHelpMarkdown`.
 *
 * Linear search across the doc tree; fine for files in the low thousands of
 * headings.
 */
export function findHelpNode(docRoot: HelpHeadingNode, anchor: string): HelpHeadingNode | null {
  if (anchor === "") return docRoot;
  let found: HelpHeadingNode | null = null;
  const walk = (node: HelpHeadingNode): void => {
    if (found) return;
    if (node.anchor === anchor) {
      found = node;
      return;
    }
    for (const c of node.children) walk(c);
  };
  for (const c of docRoot.children) walk(c);
  return found;
}

/**
 * Render a heading's body as plain markdown. With `includeChildren: true`,
 * all nested heading content is included; otherwise only the prose between
 * this heading and its first child heading is returned (which may be empty
 * when a heading is followed immediately by sub-headings).
 *
 * Leading `#` markers from descendant headings are kept as-is — clients can
 * post-process if they want pure prose.
 */
export function renderHelpBody(
  node: HelpHeadingNode,
  source: string,
  options: { includeChildren: boolean }
): string {
  const lines = source.split(/\r?\n/);
  const firstChildStart = node.children[0]?.bodyLines.start;
  const childHeadingLine =
    firstChildStart !== undefined && firstChildStart > 0 ? firstChildStart - 1 : null;
  const start = node.bodyLines.start;
  const end = options.includeChildren
    ? node.bodyLines.end
    : (childHeadingLine ?? node.bodyLines.end);
  return lines.slice(start, Math.max(start, end)).join("\n").trim();
}
