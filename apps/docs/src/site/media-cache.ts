import { existsSync } from "node:fs";
import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

/** Writes `bytes` to `file` through a temporary name, so a reader never sees half a file. */
export async function writeAtomically({ file, bytes }: { file: string; bytes: Uint8Array }) {
  await mkdir(path.dirname(file), { recursive: true });
  const partial = `${file}.${process.pid}.partial`;
  await writeFile(partial, bytes);
  await rename(partial, file);
}

/**
 * Removes every entry of a media cache this build did not use, so a restored CI cache holds only
 * the current encodings. Entries another build is still writing (`.partial`) are left alone.
 */
export async function pruneCache({
  directory,
  keep,
}: {
  directory: string | null;
  keep: ReadonlySet<string>;
}) {
  if (!directory || !existsSync(directory)) return 0;
  const stale = (await readdir(directory)).filter(
    (name) => !keep.has(name) && !name.endsWith(".partial"),
  );
  await Promise.all(
    stale.map((name) => rm(path.join(directory, name), { recursive: true, force: true })),
  );
  return stale.length;
}
