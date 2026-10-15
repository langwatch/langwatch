// Fails when the image's re-resolved lockfile names a package version the committed one does not.
// The image pnpmfile drops dev-tool peers, so the files differ by design; versions must not.
// Usage: node check-locked-versions.mjs <committed pnpm-lock.yaml> <re-resolved pnpm-lock.yaml>
import { readFileSync } from "node:fs";

/** Every `name@version` key under a `packages:` section, in every document of the lockfile. */
const lockedVersions = (text) => {
  const versions = new Set();
  let inPackages = false;
  for (const line of text.split("\n")) {
    if (/^\S/.test(line)) inPackages = line === "packages:";
    const key = inPackages ? /^ {2}(\S.*?):\s*$/.exec(line)?.[1] : undefined;
    if (key) versions.add(key.replace(/^'(.*)'$/, "$1"));
  }
  return versions;
};

const [committedPath, resolvedPath] = process.argv.slice(2);
if (!committedPath || !resolvedPath) {
  console.error("usage: check-locked-versions.mjs <committed lockfile> <re-resolved lockfile>");
  process.exit(2);
}
const known = lockedVersions(readFileSync(committedPath, "utf8"));
const resolved = lockedVersions(readFileSync(resolvedPath, "utf8"));
if (resolved.size === 0) {
  console.error(`no package versions read from ${resolvedPath}; the lockfile format changed`);
  process.exit(1);
}
const drift = [...resolved].filter((version) => !known.has(version));
for (const version of drift.slice(0, 40)) {
  console.error(`not in the committed lockfile: ${version}`);
}
if (drift.length > 0) {
  console.error(`${drift.length} package version(s) drifted from the committed lockfile`);
  process.exit(1);
}
console.log("every re-resolved package version is in the committed lockfile");
