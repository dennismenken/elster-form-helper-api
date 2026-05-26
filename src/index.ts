#!/usr/bin/env node
/**
 * Entry point. Parses CLI args + env into a `ServerConfig`, boots the
 * catalogue once, builds the MCP server, and attaches the chosen transport.
 *
 * Exit codes:
 *   0  — normal shutdown (stdio close or SIGTERM)
 *   1  — configuration error or unhandled failure during startup
 *   2  — runtime error after the server was up
 */

import { loadCatalogue } from "./catalogue/loader.js";
import { loadConfig, parseArgv, PACKAGE_ROOT } from "./env.js";
import { createLogger } from "./logger.js";
import { buildMcpServer } from "./server.js";
import { SessionStore } from "./session/store.js";
import { startHttpTransport } from "./transports/http.js";
import { startStdioTransport } from "./transports/stdio.js";
import { PACKAGE_NAME, PACKAGE_VERSION } from "./package_info.js";

async function main(): Promise<void> {
  const cli = parseArgv(process.argv.slice(2));
  let config;
  try {
    config = loadConfig(process.env, cli);
  } catch (err) {
    process.stderr.write(`configuration error: ${(err as Error).message}\n`);
    process.exit(1);
  }

  const logger = createLogger(config.logLevel);
  logger.info("server.starting", {
    package: PACKAGE_NAME,
    version: PACKAGE_VERSION,
    transport: config.transport,
    data_dir: config.dataDir,
    sessions_dir: config.sessionsDir,
    package_root: PACKAGE_ROOT,
  });

  const catalogue = await loadCatalogue({ dataDir: config.dataDir, logger });
  if (catalogue.forms.size === 0) {
    logger.error("server.no_forms", { data_dir: config.dataDir });
    process.stderr.write(
      `refusing to start: no forms found under ${config.dataDir}/forms/. Make sure src/data/ is present.\n`
    );
    process.exit(1);
  }

  const sessionStore = new SessionStore({ dir: config.sessionsDir });
  await sessionStore.init();

  const server = buildMcpServer({
    catalogue,
    sessionStore,
    logger,
    packageName: PACKAGE_NAME,
    packageVersion: PACKAGE_VERSION,
    dataCommitOverride: config.dataCommitOverride,
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info("server.shutdown", { signal });
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  try {
    if (config.transport === "stdio") {
      await startStdioTransport({ server, logger });
    } else {
      if (!config.authToken) {
        logger.error("server.http_no_token", {});
        process.exit(1);
      }
      await startHttpTransport({
        server,
        logger,
        host: config.host,
        port: config.port,
        authToken: config.authToken,
        packageVersion: PACKAGE_VERSION,
      });
    }
  } catch (err) {
    logger.error("server.fatal", { detail: (err as Error).message, stack: (err as Error).stack });
    process.exit(2);
  }
}

void main();
