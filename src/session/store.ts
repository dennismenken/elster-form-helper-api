import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { ToolError, ERROR_CODES } from "../errors.js";
import { SessionFileSchema, type SessionFile } from "./types.js";

export interface SessionStoreOptions {
  dir: string;
}

/**
 * Filesystem-backed session store. One JSON file per session. Atomic write
 * via the standard tmp-rename pattern — readers either see the previous
 * state or the new state, never a torn write.
 */
export class SessionStore {
  private readonly dir: string;

  constructor(opts: SessionStoreOptions) {
    this.dir = opts.dir;
  }

  async init(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  filePath(sessionId: string): string {
    return path.join(this.dir, `${sessionId}.json`);
  }

  async exists(sessionId: string): Promise<boolean> {
    try {
      await readFile(this.filePath(sessionId), "utf-8");
      return true;
    } catch {
      return false;
    }
  }

  async load(sessionId: string): Promise<SessionFile> {
    let raw: string;
    try {
      raw = await readFile(this.filePath(sessionId), "utf-8");
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === "ENOENT") {
        throw new ToolError({
          code: ERROR_CODES.SESSION_NOT_FOUND,
          message: `Session '${sessionId}' not found.`,
          hint: "Start a new session with `session_start`.",
        });
      }
      throw err;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new ToolError({
        code: ERROR_CODES.INTERNAL_ERROR,
        message: `Session '${sessionId}' is corrupt: ${(err as Error).message}.`,
      });
    }
    return SessionFileSchema.parse(parsed);
  }

  async save(session: SessionFile): Promise<void> {
    const validated = SessionFileSchema.parse(session);
    const finalPath = this.filePath(validated.session_id);
    const tmpPath = `${finalPath}.tmp-${process.pid}-${Date.now()}`;
    const body = `${JSON.stringify(validated, null, 2)}\n`;
    await writeFile(tmpPath, body, "utf-8");
    await rename(tmpPath, finalPath);
  }

  async list(): Promise<string[]> {
    try {
      const { readdir } = await import("node:fs/promises");
      const files = await readdir(this.dir);
      return files.filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === "ENOENT") return [];
      throw err;
    }
  }
}
