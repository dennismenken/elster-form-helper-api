import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import type { Logger } from "../logger.js";
import { normalizePages } from "./normalize.js";
import { parseHelpMarkdown } from "./help_tree.js";
import {
  type Catalogue,
  type Form,
  type HelpFile,
  type HelpMappingEntry,
  type TaxType,
  type Trigger,
  TAX_TYPES,
  formKey,
  helpFileKey,
  helpMappingKey,
} from "./types.js";

interface LoaderOptions {
  dataDir: string;
  logger: Logger;
}

interface RawTriggerIndex {
  tax_type: string;
  year: string;
  data_commit?: string;
  forms?: RawTriggerIndexForm[];
}

interface RawTriggerIndexForm {
  slug: string;
  name?: string;
  form_kind?: "main" | "annex";
  mandatory?: boolean;
  description?: string | null;
  triggers?: Trigger[];
}

interface RawHelpMappingFile {
  tax_type: string;
  year: string;
  help_markdown?: string;
  mapping?: Record<string, { page_label: string | null; help_source: string; snippet: string }>;
}

interface RawFormDisplayMeta {
  slug: string;
  /** Original directory name, e.g. "99 Anlage Geno Ver" or "00 Hauptvordruck KSt 1". */
  rawName: string;
}

/**
 * Load the entire catalogue into memory. Read-once at startup; the in-memory
 * model is treated as immutable downstream. Missing trigger-index or
 * help-mapping files degrade gracefully (logged + warning, not fatal).
 */
export async function loadCatalogue(opts: LoaderOptions): Promise<Catalogue> {
  const { dataDir, logger } = opts;

  const warnings: string[] = [];
  const forms = new Map<string, Form>();
  const yearsByTaxType = new Map<TaxType, string[]>();
  const helpMappings = new Map<string, HelpMappingEntry>();
  const helpFiles = new Map<string, HelpFile>();
  let dataCommit: string | null = null;

  for (const taxType of TAX_TYPES) {
    const taxFormsDir = path.join(dataDir, "forms", taxType);
    if (!(await dirExists(taxFormsDir))) {
      logger.debug("catalogue.skip_tax_type", { tax_type: taxType, reason: "no_forms_dir" });
      continue;
    }
    const years = (await readdir(taxFormsDir)).filter((y) => /^\d{4}$/.test(y)).sort();
    if (years.length === 0) continue;
    yearsByTaxType.set(taxType, years);

    for (const year of years) {
      const triggerIndex = await tryLoadTriggerIndex(dataDir, taxType, year, logger, warnings);
      if (dataCommit == null && triggerIndex?.data_commit) dataCommit = triggerIndex.data_commit;

      const helpMappingFile = await tryLoadHelpMapping(dataDir, taxType, year, logger, warnings);
      const yearMappings = helpMappingFile?.mapping ?? null;

      const help = await tryLoadHelpFile(dataDir, taxType, year, logger, warnings);
      if (help) helpFiles.set(helpFileKey(taxType, year), help);

      const formMetaBySlug = new Map<string, RawFormDisplayMeta>();
      const yearDir = path.join(taxFormsDir, year);
      const formFiles = (await readdir(yearDir)).filter((f) => f.endsWith(".json")).sort();
      for (const file of formFiles) {
        const slug = file.replace(/\.json$/, "");
        // The annual consolidation file (`99-{type}-{year}.json`) is for REST
        // consumers; we synthesize per-form entries from individual files.
        if (/^99-[a-z]+-\d{4}$/.test(slug)) continue;

        const filePath = path.join(yearDir, file);
        const raw = await readJson<unknown>(filePath);
        let pages;
        try {
          pages = normalizePages(raw);
        } catch (err) {
          warnings.push(
            `failed to normalize form '${taxType}/${year}/${slug}': ${(err as Error).message}`
          );
          continue;
        }

        const triggerEntry = triggerIndex?.forms?.find((f) => f.slug === slug);
        const displayName = triggerEntry?.name ?? slug;
        formMetaBySlug.set(slug, { slug, rawName: displayName });

        const formKind = triggerEntry?.form_kind ?? deriveFormKind(slug);
        const description = triggerEntry?.description ?? null;
        const mandatory = triggerEntry?.mandatory ?? formKind === "main";
        const triggers = triggerEntry?.triggers ?? [];

        const formObj: Form = {
          slug,
          name: displayName,
          form_kind: formKind,
          tax_type: taxType,
          year,
          pages,
          triggers,
          triggers_loaded: triggerEntry != null,
          description,
          mandatory,
        };
        forms.set(formKey(taxType, year, slug), formObj);
      }

      if (yearMappings) {
        for (const [key, value] of Object.entries(yearMappings)) {
          const [slug, lineNumber] = splitMappingKey(key);
          if (slug === null || lineNumber === null) continue;
          const entry: HelpMappingEntry = {
            form_slug: slug,
            line_number: lineNumber,
            page_label: value.page_label,
            help_source: value.help_source,
            snippet: value.snippet,
          };
          helpMappings.set(helpMappingKey(taxType, year, slug, lineNumber), entry);
        }
      }

      if (triggerIndex == null) {
        warnings.push(
          `no trigger-index file for ${taxType}/${year}: recommend_forms will degrade for this year`
        );
      }
      if (helpMappingFile == null) {
        warnings.push(
          `no help-mapping file for ${taxType}/${year}: get_line will return null snippets for this year`
        );
      }
    }
  }

  logger.info("catalogue.loaded", {
    forms: forms.size,
    help_files: helpFiles.size,
    help_mappings: helpMappings.size,
    warnings: warnings.length,
    data_commit: dataCommit,
  });
  for (const w of warnings) logger.warn("catalogue.warning", { detail: w });

  return {
    forms,
    yearsByTaxType: new Map(
      Array.from(yearsByTaxType.entries()).map(([k, v]) => [k, Object.freeze([...v])])
    ),
    helpMappings,
    helpFiles,
    warnings: Object.freeze([...warnings]),
    dataCommit,
  };
}

async function tryLoadTriggerIndex(
  dataDir: string,
  taxType: TaxType,
  year: string,
  logger: Logger,
  warnings: string[]
): Promise<RawTriggerIndex | null> {
  const filePath = path.join(dataDir, "trigger-index", `${taxType}-${year}.json`);
  try {
    return await readJson<RawTriggerIndex>(filePath);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code !== "ENOENT") {
      warnings.push(`failed to load ${path.relative(dataDir, filePath)}: ${e.message}`);
      logger.error("catalogue.trigger_index_load_failed", { file: filePath, error: e.message });
    }
    return null;
  }
}

async function tryLoadHelpMapping(
  dataDir: string,
  taxType: TaxType,
  year: string,
  logger: Logger,
  warnings: string[]
): Promise<RawHelpMappingFile | null> {
  const filePath = path.join(dataDir, "help-mapping", `${taxType}-${year}.json`);
  try {
    return await readJson<RawHelpMappingFile>(filePath);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code !== "ENOENT") {
      warnings.push(`failed to load ${path.relative(dataDir, filePath)}: ${e.message}`);
      logger.error("catalogue.help_mapping_load_failed", { file: filePath, error: e.message });
    }
    return null;
  }
}

async function tryLoadHelpFile(
  dataDir: string,
  taxType: TaxType,
  year: string,
  logger: Logger,
  warnings: string[]
): Promise<HelpFile | null> {
  const dir = path.join(dataDir, "help", taxType, year);
  if (!(await dirExists(dir))) return null;
  const files = (await readdir(dir)).filter((f) => /^elster_.*_help\.md$/i.test(f));
  if (files.length === 0) {
    warnings.push(`help directory exists for ${taxType}/${year} but contains no help markdown`);
    return null;
  }
  if (files.length > 1) {
    warnings.push(`multiple help markdowns under ${taxType}/${year}: using ${files[0]!}`);
  }
  const filename = files[0]!;
  const source = await readFile(path.join(dir, filename), "utf-8");
  const { root, docRoot } = parseHelpMarkdown(source);
  logger.debug("catalogue.help_file_loaded", { tax_type: taxType, year, file: filename });
  return { tax_type: taxType, year, filename, source, root, docRoot };
}

async function readJson<T>(filePath: string): Promise<T> {
  const text = await readFile(filePath, "utf-8");
  return JSON.parse(text) as T;
}

async function dirExists(p: string): Promise<boolean> {
  try {
    const s = await stat(p);
    return s.isDirectory();
  } catch {
    return false;
  }
}

function deriveFormKind(slug: string): "main" | "annex" {
  return slug.startsWith("00-") || slug.includes("hauptvordruck") ? "main" : "annex";
}

function splitMappingKey(key: string): [string | null, string | null] {
  const idx = key.indexOf(":");
  if (idx < 0) return [null, null];
  return [key.slice(0, idx), key.slice(idx + 1)];
}
