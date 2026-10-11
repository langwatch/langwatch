import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const siteRoot = path.dirname(fileURLToPath(import.meta.url));
const dsDir = realpathSync(path.join(siteRoot, "node_modules/@langwatch/design-system"));
const dsRequire = createRequire(path.join(dsDir, "package.json"));

/** Resolves a package the design system depends on, so the docs build need not declare it. */
export function resolveFromDesignSystem({ name }) {
  return dsRequire.resolve(name);
}

export function lucideRoot() {
  const file = resolveFromDesignSystem({ name: "lucide-react" });
  return file.slice(0, file.indexOf("/lucide-react/") + "/lucide-react".length);
}
