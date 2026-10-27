import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { stripFeaturePrefix } from "@langwatch/oxlint-rules/grammar/feature-layout-policy.mjs";

function isDirectory(path: string): boolean {
  return existsSync(path) && statSync(path).isDirectory();
}

/**
 * A process package's repositories directories: the top-level one, then each
 * `features/<concern>/repositories/`. One registry serves them all.
 */
export function repositoryHomes({ src }: { src: string }): string[] {
  const features = join(src, "features");
  const concerns = isDirectory(features)
    ? readdirSync(features).toSorted((a, b) => a.localeCompare(b))
    : [];
  const candidates = [
    join(src, "repositories"),
    ...concerns.map((name) => join(features, name, "repositories")),
  ];

  return candidates.filter(
    (path) =>
      isDirectory(path) &&
      stripFeaturePrefix(relative(src, path).split(sep).join("/")) === "repositories",
  );
}
