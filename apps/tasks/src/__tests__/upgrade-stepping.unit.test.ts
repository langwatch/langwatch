/**
 * @see specs/upgrade/stepping.feature
 */
import type { ManifestStep, ReleaseManifest } from "@langwatch/upgrade/manifest";
import type { SchemaTargetReport, UpgradeSchemaApplier } from "@langwatch/upgrade/runner";
import { describe, expect, it } from "vitest";

import {
  clickHouseRunOptions,
  releaseSchemaUpTo,
  releaseSteppingApplier,
  type StepSchemaTo,
  type UpgradeTaskLine,
} from "../upgrade.ts";

const step = (id: string, kind: ManifestStep["kind"]): ManifestStep => ({
  id,
  kind,
  mode: "blocking",
  owner: null,
  description: `step ${id}`,
});

const MANIFESTS: ReleaseManifest[] = [
  {
    release: "3.20.1",
    previous: null,
    cutAt: "2026-10-02T09:39:24+02:00",
    steps: [step("prisma:20261001000000_base", "postgres-schema")],
  },
  {
    release: "3.21.0",
    previous: "3.20.1",
    cutAt: "2026-10-03T09:00:00+02:00",
    steps: [
      step("prisma:20261002000000_add", "postgres-schema"),
      step("clickhouse:00002", "clickhouse-schema"),
      step("dataset:copy-keys", "data"),
    ],
  },
  {
    release: "3.22.0",
    previous: "3.21.0",
    cutAt: "2026-10-04T09:00:00+02:00",
    steps: [step("prisma:20261003000000_more", "postgres-schema")],
  },
];

const POSTGRES_OK: SchemaTargetReport = {
  engine: "postgres",
  target: "postgres",
  ok: true,
  error: null,
};

/** The stepping applier over a recording one-pass applier and a recording step. */
function steppingOver({ failOn }: { failOn?: string } = {}) {
  const calls: string[] = [];
  const lines: UpgradeTaskLine[] = [];
  const onePass: UpgradeSchemaApplier = {
    apply: async ({ release }) => {
      calls.push(`one pass to ${release ?? "unreleased"}`);
      return [POSTGRES_OK];
    },
    resolveRolledBack: async ({ migration }) => {
      calls.push(`resolve ${migration}`);
      return { ok: true, error: null };
    },
  };
  const stepTo: StepSchemaTo = async ({ release, prismaFolders, gooseUpTo }) => {
    calls.push(`step to ${release}: ${prismaFolders.join(", ")}; goose ${gooseUpTo}`);
    if (release === failOn)
      return { reports: [{ ...POSTGRES_OK, ok: false, error: "P3018" }], applied: [] };
    return { reports: [POSTGRES_OK], applied: prismaFolders.slice(-1) };
  };
  const applier = releaseSteppingApplier({
    imageRelease: "3.22.0",
    manifests: MANIFESTS,
    onePass,
    stepTo,
    say: (line) => lines.push(line),
  });
  const apply = (release: string | null) =>
    applier.apply({ release, lockTimeoutMs: 10_000, signal: new AbortController().signal });
  return { applier, apply, calls, lines };
}

describe("the upgrade's schema applier", () => {
  describe("when the upgrade applies one release", () => {
    /** @scenario "A one-release upgrade applies the whole schema in one pass, as before" */
    it("hands every call to the one-pass applier and says nothing of stepping", async () => {
      const { apply, calls, lines } = steppingOver();
      await apply("3.22.0");
      await apply(null);
      expect(calls).toEqual(["one pass to 3.22.0", "one pass to unreleased"]);
      expect(lines).toEqual([]);
    });

    it("hands a fresh install's or the unreleased steps' call to the one-pass applier", async () => {
      const { apply, calls, lines } = steppingOver();
      await apply(null);
      expect(calls).toEqual(["one pass to unreleased"]);
      expect(lines).toEqual([]);
    });
  });

  describe("when the upgrade jumps several releases", () => {
    /** @scenario "A jump across several releases steps Postgres through each release's folders in turn" */
    it("steps each release over every folder up to it and the last goose version up to it", async () => {
      const { apply, calls } = steppingOver();
      await apply("3.21.0");
      await apply("3.22.0");
      expect(calls).toEqual([
        "step to 3.21.0: 20261001000000_base, 20261002000000_add; goose 2",
        "step to 3.22.0: 20261001000000_base, 20261002000000_add, 20261003000000_more; goose 2",
      ]);
    });

    /** @scenario "The unreleased steps after a stepped jump are applied in one pass" */
    it("applies the unreleased tail with the one-pass applier", async () => {
      const { apply, calls } = steppingOver();
      await apply("3.21.0");
      await apply(null);
      expect(calls).toEqual([
        "step to 3.21.0: 20261001000000_base, 20261002000000_add; goose 2",
        "one pass to unreleased",
      ]);
    });

    /** @scenario "Each stepped release is named on the console before and after its schema" */
    it("says it steps, then names each release before and after its schema", async () => {
      const { apply, lines } = steppingOver();
      await apply("3.21.0");
      await apply("3.22.0");
      expect(lines.map((line) => [line.level, line.fields.release])).toEqual([
        ["info", undefined],
        ["info", "3.21.0"],
        ["info", "3.21.0"],
        ["info", "3.22.0"],
        ["info", "3.22.0"],
      ]);
      expect(lines[0]?.message).toContain("one release at a time up to 3.22.0");
      expect(lines[1]?.message).toBe(
        "stepping the schema to 3.21.0: 2 Prisma folder(s) up to it, ClickHouse up to version 2",
      );
      expect(lines[2]?.message).toBe(
        "schema stepped to 3.21.0: 1 Prisma migration(s) applied; its blocking steps run next",
      );
    });

    /** @scenario "A stepped release whose schema fails is named with the failing target" */
    it("warns naming the release and the target, and returns the failed report", async () => {
      const { apply, lines } = steppingOver({ failOn: "3.21.0" });
      const reports = await apply("3.21.0");
      expect(reports).toEqual([{ ...POSTGRES_OK, ok: false, error: "P3018" }]);
      expect(lines.at(-1)).toMatchObject({
        level: "warn",
        message: "schema step to 3.21.0 failed on postgres",
        fields: { release: "3.21.0", failed: ["postgres"] },
      });
    });

    it("resolves a failed migration through the one-pass applier", async () => {
      const { applier, calls } = steppingOver();
      await applier.resolveRolledBack?.({
        migration: "20261002000000_add",
        signal: new AbortController().signal,
      });
      expect(calls).toEqual(["resolve 20261002000000_add"]);
    });
  });
});

describe("releaseSchemaUpTo()", () => {
  /** @scenario "A release with no goose version up to it steps no ClickHouse version" */
  it("names no goose version for a release whose manifests up to it carry none", () => {
    expect(releaseSchemaUpTo({ release: "3.20.1", manifests: MANIFESTS })).toEqual({
      prismaFolders: ["20261001000000_base"],
      gooseUpTo: null,
    });
  });
});

describe("clickHouseRunOptions()", () => {
  const settings = { clusterName: undefined, childEnvironment: {}, waitSeconds: 5 };

  /** @scenario "A stepped release migrates ClickHouse up to its own last goose version" */
  it("carries the release's goose version when stepping and none in one pass", () => {
    const url = "http://clickhouse:8123/langwatch";
    expect(clickHouseRunOptions({ url, settings, upTo: 2, signal: undefined }).upTo).toBe(2);
    expect(clickHouseRunOptions({ url, settings, upTo: undefined, signal: undefined })).toEqual({
      connectionUrl: url,
      clusterName: undefined,
      childEnvironment: {},
      waitSeconds: 5,
      verbose: true,
    });
    expect(
      "upTo" in clickHouseRunOptions({ url, settings, upTo: undefined, signal: undefined }),
    ).toBe(false);
  });
});
