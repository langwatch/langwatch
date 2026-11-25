import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { compareReleases, ManifestLoadError, releaseVersionSchema } from "./manifest.ts";

/** What this image still ships but retires (ruling D8); a folder of its own, as `image/` has. */
export const DEPRECATIONS_FILE = fileURLToPath(
  new URL("../../releases/deprecations/deprecations.json", import.meta.url),
);

/**
 * One thing this image still ships but no code reaches. `deprecatedIn: null` is the unreleased
 * release; `removedIn: null` is "a future release", not yet named.
 */
export const deprecationSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*:[A-Za-z0-9_]+$/),
  what: z.string().min(1),
  kind: z.enum(["postgres-table", "clickhouse-table"]),
  deprecatedIn: releaseVersionSchema.nullable(),
  removedIn: releaseVersionSchema.nullable(),
  successor: z.string().min(1).optional(),
  notice: z.string().min(1),
});
export type Deprecation = z.infer<typeof deprecationSchema>;

export const deprecationsSchema = z.array(deprecationSchema);

/** Parses the register; refuses a duplicate id and a removal before its deprecation. */
export function parseDeprecations({ text }: { text: string }): Deprecation[] {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new ManifestLoadError({
      code: "invalid_manifest",
      message: `deprecations.json is not JSON: ${(error as Error).message}`,
    });
  }
  const parsed = deprecationsSchema.safeParse(json);
  if (!parsed.success) {
    throw new ManifestLoadError({
      code: "invalid_manifest",
      message: `deprecations.json is not a deprecation list: ${parsed.error.message}`,
    });
  }
  const seen = new Set<string>();
  for (const entry of parsed.data) {
    if (seen.has(entry.id)) {
      throw new ManifestLoadError({
        code: "invalid_manifest",
        message: `deprecations.json names ${entry.id} twice`,
      });
    }
    seen.add(entry.id);
    const { deprecatedIn, removedIn } = entry;
    if (
      deprecatedIn &&
      removedIn &&
      compareReleases({ left: removedIn, right: deprecatedIn }) < 0
    ) {
      throw new ManifestLoadError({
        code: "invalid_manifest",
        message: `${entry.id} is removed in ${removedIn}, before it is deprecated in ${deprecatedIn}`,
      });
    }
  }
  return parsed.data;
}

/** Reads the register this image ships. */
export function loadDeprecations({
  file = DEPRECATIONS_FILE,
}: { file?: string } = {}): Deprecation[] {
  return parseDeprecations({ text: readFileSync(file, "utf8") });
}
