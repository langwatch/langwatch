import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const CONCURRENT_WRITES = 32;

/** Writes `files` (output-relative path to contents) under `root`, creating each folder once. */
export async function writeOutputFiles({
  root,
  files,
}: {
  root: string;
  files: ReadonlyMap<string, string | Uint8Array>;
}) {
  const targets = [...files.keys()].map((name) => {
    const target = path.resolve(root, name);
    if (!target.startsWith(root + path.sep))
      throw new Error(`Output file escapes the build directory: ${name}`);
    return target;
  });
  for (const folder of new Set(targets.map((target) => path.dirname(target))))
    await mkdir(folder, { recursive: true });
  const contents = [...files.values()];
  let next = 0;
  async function drain() {
    while (next < targets.length) {
      const index = next;
      next += 1;
      await writeFile(targets[index], contents[index]);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENT_WRITES }, drain));
}
