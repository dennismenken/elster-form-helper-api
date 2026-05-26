import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import { fileURLToPath } from "node:url";

import { loadCatalogue } from "../src/catalogue/loader.js";
import { createLogger } from "../src/logger.js";
import { SessionStore } from "../src/session/store.js";
import { buildProvenanceContext } from "../src/provenance.js";
import type { ToolContext } from "../src/tools/envelope.js";
import type { Catalogue } from "../src/catalogue/types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, "..");
export const REAL_DATA_DIR = path.join(REPO_ROOT, "src", "data");

/**
 * Spin up an isolated test context: a real catalogue loaded from the
 * committed `src/data/` tree (so tests run against the same data the server
 * ships with) plus a session store rooted in a fresh tmpdir so each test
 * gets a clean slate.
 */
export async function buildTestContext(): Promise<{
  ctx: ToolContext;
  catalogue: Catalogue;
  cleanup: () => Promise<void>;
}> {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "elster-forms-test-"));
  const logger = createLogger("silent");
  const catalogue = await loadCatalogue({ dataDir: REAL_DATA_DIR, logger });
  const sessionStore = new SessionStore({ dir: tmpDir });
  await sessionStore.init();
  const provenance = buildProvenanceContext({
    dataCommitFromTriggerIndex: catalogue.dataCommit,
    dataCommitOverride: null,
    packageVersion: "test",
  });
  return {
    catalogue,
    ctx: { catalogue, sessionStore, provenance, logger },
    cleanup: async () => {
      await rm(tmpDir, { recursive: true, force: true });
    },
  };
}
