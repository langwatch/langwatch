/**
 * The schema applier that steps an upgrade one release at a time, and the lines it says. Moved
 * from apps/tasks so the worker can compose the runner in-process (slice 2 of the 2026-10-11
 * upgrade plan). Spec: specs/upgrade/stepping.feature.
 */
import { compareReleases } from "../manifest/manifest.ts";
import type { ReleaseManifest } from "../manifest/manifest.ts";
import type { SchemaTargetReport, UpgradeSchemaApplier } from "./schema-applier.ts";

/** The migration session's URL with `lock_timeout` added to any session options already there. */
export function withLockTimeout({
  url,
  lockTimeoutMs,
}: {
  url: string;
  lockTimeoutMs: number;
}): string {
  const parsed = new URL(url);
  const option = `-c lock_timeout=${lockTimeoutMs}`;
  const existing = parsed.searchParams.get("options");
  parsed.searchParams.set("options", existing ? `${existing} ${option}` : option);
  return parsed.toString();
}

/** A line the upgrade says, kept pure so its wording is tested without a logger. */
export type UpgradeTaskLine = Readonly<{
  level: "info" | "warn" | "error";
  message: string;
  fields: Record<string, unknown>;
}>;

/** What stepping to a release applies: every Prisma folder and the last goose version up to it. */
export function releaseSchemaUpTo({
  release,
  manifests,
}: {
  release: string;
  manifests: readonly ReleaseManifest[];
}): { prismaFolders: string[]; gooseUpTo: number | null } {
  const ids = manifests
    .filter((manifest) => compareReleases({ left: manifest.release, right: release }) <= 0)
    .flatMap((manifest) => manifest.steps.map((step) => step.id));
  const named = (prefix: string) =>
    ids.filter((id) => id.startsWith(prefix)).map((id) => id.slice(prefix.length));
  const versions = named("clickhouse:").map(Number);
  return {
    prismaFolders: named("prisma:"),
    gooseUpTo: versions.length > 0 ? Math.max(...versions) : null,
  };
}

/** What one stepped release did: its target reports and the Prisma folders it applied. */
export type SteppedSchema = Readonly<{
  reports: readonly SchemaTargetReport[];
  applied: readonly string[];
}>;

/** Applies the schema up to one release; the stepping applier calls it once per release. */
export type StepSchemaTo = (args: {
  release: string;
  prismaFolders: readonly string[];
  gooseUpTo: number | null;
  lockTimeoutMs: number;
  signal: AbortSignal;
  skipTargets?: ReadonlySet<string>;
}) => Promise<SteppedSchema>;

/** Said once, when the first schema to apply is older than the image's release. */
export function steppingStartsLine({
  imageRelease,
}: {
  imageRelease: string | null;
}): UpgradeTaskLine {
  return {
    level: "info",
    message: `the upgrade crosses several releases: the schema steps one release at a time up to ${imageRelease ?? "this image"}, each release's blocking steps after its schema`,
    fields: { phase: "schema", waitingOn: "nothing", next: "nothing to do: wait for the run" },
  };
}

/** Said before one release's schema is applied. */
export function stepToLine({
  release,
  prismaFolders,
  gooseUpTo,
}: {
  release: string;
  prismaFolders: readonly string[];
  gooseUpTo: number | null;
}): UpgradeTaskLine {
  const clickhouse =
    gooseUpTo === null ? "no ClickHouse version up to it" : `ClickHouse up to version ${gooseUpTo}`;
  return {
    level: "info",
    message: `stepping the schema to ${release}: ${prismaFolders.length} Prisma folder(s) up to it, ${clickhouse}`,
    fields: {
      phase: "schema",
      release,
      waitingOn: "prisma migrate deploy, then goose",
      next: "nothing to do: wait for the run",
    },
  };
}

/** Said after one release's schema: what it applied, or which targets failed. */
export function steppedLine({
  release,
  stepped,
}: {
  release: string;
  stepped: SteppedSchema;
}): UpgradeTaskLine {
  const failed = stepped.reports.filter((report) => !report.ok).map((report) => report.target);
  const fields = { phase: "schema", release, applied: stepped.applied };
  if (failed.length === 0)
    return {
      level: "info",
      message: `schema stepped to ${release}: ${stepped.applied.length} Prisma migration(s) applied; its blocking steps run next`,
      fields: { ...fields, waitingOn: "nothing" },
    };
  return {
    level: "warn",
    message: `schema step to ${release} failed on ${failed.join(", ")}`,
    fields: { ...fields, failed, waitingOn: "the runner's retry or its failure report" },
  };
}

/**
 * One release, a fresh install or only the unreleased tail: the one-pass applier, unchanged. A
 * first schema older than the image steps each release in turn, the unreleased tail in one pass
 * (specs/upgrade/stepping.feature).
 */
export function releaseSteppingApplier({
  imageRelease,
  manifests,
  onePass,
  stepTo,
  say,
}: {
  imageRelease: string | null;
  manifests: readonly ReleaseManifest[];
  onePass: UpgradeSchemaApplier;
  stepTo: StepSchemaTo;
  say: (line: UpgradeTaskLine) => void;
}): UpgradeSchemaApplier {
  let stepping: boolean | undefined;
  return {
    ...onePass,
    async apply(args) {
      const { release, lockTimeoutMs, signal, skipTargets } = args;
      if (stepping === undefined) {
        stepping = release !== null && release !== imageRelease;
        if (stepping) say(steppingStartsLine({ imageRelease }));
      }
      if (!stepping || release === null) return onePass.apply(args);
      const schema = releaseSchemaUpTo({ release, manifests });
      say(stepToLine({ release, ...schema }));
      const stepped = await stepTo({ release, ...schema, lockTimeoutMs, signal, skipTargets });
      say(steppedLine({ release, stepped }));
      return stepped.reports;
    },
  };
}
