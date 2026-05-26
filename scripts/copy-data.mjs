// Post-build helper: copy the runtime data tree from src/data into dist/data
// so the compiled server keeps the same relative path resolution it uses in
// development. Invoked from `npm run build`.

import { cp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const src = path.join(root, "src", "data");
const dst = path.join(root, "dist", "data");

await rm(dst, { recursive: true, force: true });
await cp(src, dst, { recursive: true });
console.log(`copied ${path.relative(root, src)} -> ${path.relative(root, dst)}`);
