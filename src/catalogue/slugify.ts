/**
 * Slugify with the same algorithm used by `formular_daten_generator.py` and
 * the build pipeline in `elster-forms-data/scripts`. ASCII-only on purpose:
 * German umlauts and ß are dropped (not transliterated). Slugs produced here
 * are byte-identical to slugs already committed under `src/data/`.
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
