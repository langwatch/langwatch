import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { z } from "zod";

import { ManifestLoadError, manifestStepIdSchema, releaseVersionSchema } from "./manifest.ts";

/** The steps shipped before the first manifest; a folder of its own, as `deprecations/` has. */
export const RELEASE_BASELINE_FILE = fileURLToPath(
  new URL("../../releases/baseline/baseline.json", import.meta.url),
);

/**
 * Every step id the tree held at `release`, the first manifest's `previous` (3.18.1): the
 * manifests start after it, so these count as stamped. Read from the release tag once; it never
 * changes. Spec: packages/upgrade/specs/release-baseline.feature.
 */
export const releaseBaselineSchema = z.object({
  release: releaseVersionSchema,
  steps: z.array(manifestStepIdSchema),
});
export type ReleaseBaseline = z.infer<typeof releaseBaselineSchema>;

export function parseReleaseBaseline({ text }: { text: string }): ReleaseBaseline {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new ManifestLoadError({
      code: "invalid_manifest",
      message: `baseline.json is not JSON: ${error instanceof Error ? error.message : String(error)}`,
    });
  }
  const parsed = releaseBaselineSchema.safeParse(json);
  if (!parsed.success) {
    throw new ManifestLoadError({
      code: "invalid_manifest",
      message: `baseline.json is not a release baseline: ${parsed.error.message}`,
    });
  }
  return parsed.data;
}

/** Reads the baseline this image ships. */
export function loadReleaseBaseline({
  file = RELEASE_BASELINE_FILE,
}: { file?: string } = {}): ReleaseBaseline {
  return parseReleaseBaseline({ text: readFileSync(file, "utf8") });
}
