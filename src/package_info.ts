/**
 * Compile-time package identity. We resolve `name` and `version` once at
 * module load by reading the bundled `package.json` so the running binary
 * always reports its own version, independent of how it was started.
 *
 * The JSON is imported with an `assert { type: "json" }` clause to keep
 * NodeNext / Bun / Deno happy at the same time.
 */

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

interface PackageJson {
  name: string;
  version: string;
}

const pkg = require("../package.json") as PackageJson;

export const PACKAGE_NAME: string = pkg.name;
export const PACKAGE_VERSION: string = pkg.version;
