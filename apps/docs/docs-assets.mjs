import { existsSync } from "node:fs";
import { open, readdir } from "node:fs/promises";
import path from "node:path";

async function assetFiles(directory) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await assetFiles(file)));
    else if (entry.isFile()) files.push(file);
  }
  return files;
}

export async function assertMaterializedAssets({ docsRoot, publicRoot }) {
  const files = [];
  for (const directory of ["images", "media", "logo", "scripts/video"]) {
    files.push(...(await assetFiles(path.join(docsRoot, directory))));
  }
  if (publicRoot) files.push(...(await assetFiles(publicRoot)));
  const favicon = path.join(docsRoot, "favicon.svg");
  if (existsSync(favicon)) files.push(favicon);
  for (const file of files) {
    const handle = await open(file, "r");
    try {
      const { buffer, bytesRead } = await handle.read(Buffer.alloc(128), 0, 128, 0);
      const prefix = buffer.subarray(0, bytesRead).toString("utf8");
      if (prefix.startsWith("version https://git-lfs.github.com/spec/v1\n")) {
        throw new Error(
          `Git LFS asset is not downloaded: ${path.relative(docsRoot, file)}. Run git lfs pull before building the docs.`,
        );
      }
    } finally {
      await handle.close();
    }
  }
}
