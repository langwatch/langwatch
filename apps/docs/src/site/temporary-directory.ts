import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";

/** Runs `run` with a new directory under `parent` and removes only that directory afterwards. */
export async function withTemporaryDirectory<T>({
  parent,
  prefix,
  run,
}: {
  parent: string;
  prefix: string;
  run: (directory: string) => Promise<T>;
}) {
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(path.join(parent, prefix));
  try {
    return await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
