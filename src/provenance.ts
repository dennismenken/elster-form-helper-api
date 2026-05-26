/**
 * Provenance is the contract between every tool output and the LLM:
 *
 *   - `data_commit`: a stable identifier of the data the server is serving.
 *     Sourced from the trigger-index files committed in `src/data/`, with
 *     fallbacks to an env-var override and finally the package version.
 *   - `source`: a human-readable location string that lets the LLM cite
 *     where a piece of content came from (e.g. "Anlage GK 2025, Page 4 /
 *     2 - Bilanzielles Ergebnis, line 14").
 *   - `help_source`: present whenever the response carries help text, so
 *     the LLM can show the user where the snippet comes from.
 */

export interface Provenance {
  data_commit: string;
  source: string;
  help_source?: string;
}

export interface ProvenanceContextInput {
  /** First-found data_commit from the loaded trigger-index files. */
  dataCommitFromTriggerIndex: string | null;
  /** Explicit env-var override (DATA_COMMIT). */
  dataCommitOverride: string | null;
  /** Final fallback, e.g. the package.json version string. */
  packageVersion: string;
}

export interface ProvenanceContext {
  dataCommit: string;
}

export function buildProvenanceContext(input: ProvenanceContextInput): ProvenanceContext {
  return {
    dataCommit:
      input.dataCommitOverride ?? input.dataCommitFromTriggerIndex ?? `v${input.packageVersion}`,
  };
}

export function makeProvenance(
  ctx: ProvenanceContext,
  source: string,
  helpSource?: string
): Provenance {
  const p: Provenance = { data_commit: ctx.dataCommit, source };
  if (helpSource !== undefined) p.help_source = helpSource;
  return p;
}
