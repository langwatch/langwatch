import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  compareReleases,
  ltsFloorSchema,
  ManifestLoadError,
  releaseManifestSchema,
} from "./manifest.ts";
import type { LtsFloor, ReleaseManifest } from "./manifest.ts";

/** The manifests and the floor ship in the image beside the package's source. */
export const RELEASES_DIRECTORY = fileURLToPath(new URL("../../releases/", import.meta.url));
export const LTS_FLOOR_FILE = "lts-floor.json";

function parseJson({ name, text }: { name: string; text: string }): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ManifestLoadError({
      code: "invalid_manifest",
      message: `${name} is not JSON: ${(error as Error).message}`,
    });
  }
}

/**
 * Parses manifest files, oldest release first. Refuses a file not named for its release and a
 * step id two manifests both name: a step belongs to exactly one release.
 */
export function parseManifests({
  files,
}: {
  files: readonly { name: string; text: string }[];
}): ReleaseManifest[] {
  const manifests = files.map(({ name, text }) => {
    const parsed = releaseManifestSchema.safeParse(parseJson({ name, text }));
    if (!parsed.success) {
      throw new ManifestLoadError({
        code: "invalid_manifest",
        message: `${name} is not a release manifest: ${parsed.error.message}`,
      });
    }
    if (name !== `${parsed.data.release}.json`) {
      throw new ManifestLoadError({
        code: "release_mismatch",
        message: `${name} declares release ${parsed.data.release}; name it ${parsed.data.release}.json`,
      });
    }
    return parsed.data;
  });
  const sorted = manifests.toSorted((left, right) =>
    compareReleases({ left: left.release, right: right.release }),
  );
  const shippedBy = new Map<string, string>();
  for (const manifest of sorted) {
    for (const step of manifest.steps) {
      const earlier = shippedBy.get(step.id);
      if (earlier) {
        throw new ManifestLoadError({
          code: "duplicate_step",
          message: `${step.id} is named by both ${earlier} and ${manifest.release}`,
        });
      }
      shippedBy.set(step.id, manifest.release);
    }
  }
  return sorted;
}

export function parseLtsFloor({ text }: { text: string }): LtsFloor {
  const parsed = ltsFloorSchema.safeParse(parseJson({ name: LTS_FLOOR_FILE, text }));
  if (!parsed.success) {
    throw new ManifestLoadError({
      code: "invalid_floor",
      message: `${LTS_FLOOR_FILE} is not an LTS floor: ${parsed.error.message}`,
    });
  }
  return parsed.data;
}

/** Reads every `<release>.json` and `lts-floor.json` from a releases directory. */
export function loadReleases({ directory = RELEASES_DIRECTORY }: { directory?: string } = {}): {
  manifests: ReleaseManifest[];
  floor: LtsFloor;
} {
  const names = readdirSync(directory).filter(
    (name) => name.endsWith(".json") && name !== LTS_FLOOR_FILE,
  );
  return {
    manifests: parseManifests({
      files: names.map((name) => ({ name, text: readFileSync(join(directory, name), "utf8") })),
    }),
    floor: parseLtsFloor({ text: readFileSync(join(directory, LTS_FLOOR_FILE), "utf8") }),
  };
}
