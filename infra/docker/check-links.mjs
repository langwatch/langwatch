// Fails when a symlink under the given root points at nothing. The image keeps the
// production install's links and deletes what no process runs, so a link whose target
// was deleted is the one mistake that builds clean and dies at the first import.
import { lstatSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.argv[2] ?? "/app";
const dangling = [];
const pending = [root];
while (pending.length > 0) {
  const dir = pending.pop();
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (lstatSync(path).isSymbolicLink()) {
      try {
        statSync(path);
      } catch {
        dangling.push(path);
      }
    } else if (lstatSync(path).isDirectory()) {
      pending.push(path);
    }
  }
}
for (const path of dangling.slice(0, 40)) console.error(`dangling link: ${path}`);
if (dangling.length > 0) {
  console.error(`${dangling.length} dangling symlink(s) under ${root}`);
  process.exit(1);
}
console.log(`no dangling symlinks under ${root}`);
