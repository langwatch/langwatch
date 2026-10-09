import { z } from "zod";

import { upgradeStepKindSchema, upgradeStepModeSchema } from "../ledger.ts";

/** A released version, `major.minor.patch`; release-please cuts no pre-release of the app. */
export const releaseVersionSchema = z.string().regex(/^\d+\.\d+\.\d+$/);
export type ReleaseVersion = z.infer<typeof releaseVersionSchema>;

/** Step id grammar, blitz plan 5.3: `prisma:<folder>`, `clickhouse:<00000>`, `<module>:<name>`. */
export const manifestStepIdSchema = z
  .string()
  .regex(/^(prisma:[A-Za-z0-9_]+|clickhouse:\d{5}|[a-z][a-z0-9-]*:[a-z0-9][a-z0-9-]*)$/);

export const manifestStepSchema = z.object({
  id: manifestStepIdSchema,
  kind: upgradeStepKindSchema,
  mode: upgradeStepModeSchema,
  owner: z.string().min(1).nullable(),
  description: z.string().min(1),
  /** The release a background step must have finished by, as it declares it. */
  finishBy: releaseVersionSchema.optional(),
});
export type ManifestStep = z.infer<typeof manifestStepSchema>;

/** `packages/upgrade/releases/<release>.json`: every step id the release shipped, in run order. */
export const releaseManifestSchema = z.object({
  release: releaseVersionSchema,
  previous: releaseVersionSchema.nullable(),
  cutAt: z.iso.datetime({ offset: true }),
  steps: z.array(manifestStepSchema),
});
export type ReleaseManifest = z.infer<typeof releaseManifestSchema>;

/** `packages/upgrade/releases/lts-floor.json`: the oldest release this image upgrades from. */
export const ltsFloorSchema = z.object({
  release: releaseVersionSchema,
  namedAt: z.iso.date(),
});
export type LtsFloor = z.infer<typeof ltsFloorSchema>;

export const SCHEMA_STEP_KINDS: ReadonlySet<ManifestStep["kind"]> = new Set([
  "postgres-schema",
  "clickhouse-schema",
]);

/** Orders two released versions numerically: negative when `left` is older. */
export function compareReleases({ left, right }: { left: string; right: string }): number {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < 3; index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

export const manifestLoadErrorCodes = [
  "invalid_manifest",
  "release_mismatch",
  "duplicate_step",
  "invalid_floor",
] as const;

/** Raised while reading the shipped manifests; `code` is what a caller branches on. */
export class ManifestLoadError extends Error {
  readonly code: (typeof manifestLoadErrorCodes)[number];

  constructor({ code, message }: { code: ManifestLoadError["code"]; message: string }) {
    super(message);
    this.name = "ManifestLoadError";
    this.code = code;
  }
}
