import { describe, expect, it } from "vitest";

import {
  CANONICAL_ARTIFACTS,
  FRAMEWORK_HOMES,
  PROCESS_PATTERNS,
  QUALIFIED_ARTIFACTS,
  RULES_PATTERN,
  claimedSubjects,
  entrySourcePaths,
  isFrameworkHome,
  isLowerKebabFilename,
  optsIntoFeatureLayout,
} from "../../grammar/feature-layout-policy.mjs";

// ADR-181: an opted-in framework package nests like a process half. The message a
// refused file prints is the allowlist read aloud, so the two are pinned together.

const TOP_LEVEL = [
  "app/event-sourcing.app.ts",
  "vocabulary/eventing.ts",
  "vocabulary/eventing.errors.ts",
  "vocabulary/event.schemas.ts",
  "telemetry/eventing.metrics.ts",
  "tasks/reap-stranded-groups.task.ts",
  "services/fold-dispatch.service.ts",
  "repositories/lua-script.repository.ts",
  "repositories/redis/redis.lua-script.store.ts",
  "repositories/redis/redis.group-helpers.script.ts",
  "channels/lane-queue.channel.ts",
  "channels/redis/redis.lane-queue.channel.ts",
  "eventing/read-hints.pipeline.ts",
  "rules/compare-ordinal.rules.ts",
];

const NESTED = [
  "features/keyspace/services/group-keyspace.service.ts",
  "features/keyspace/repositories/group-keyspace.repository.ts",
  "features/keyspace/repositories/redis/redis.group-staging.repository.ts",
  "features/keyspace/repositories/redis/redis.stage-batch.script.ts",
  "features/blobs/repositories/tiered/tiered.blob.repository.ts",
  "features/process-managers/repositories/prisma/prisma.process-store.repository.ts",
  "features/process-managers/repositories/memory/memory.process-store.repository.ts",
  "features/replay/channels/queue-activity.channel.ts",
  "features/replay/channels/redis/redis.queue-activity.channel.ts",
  "features/lanes/channels/memory/memory.lane-queue.channel.ts",
  "features/commands/vocabulary/command.ts",
  "features/commands/vocabulary/command.errors.ts",
  "features/failure/rules/retry.rules.ts",
  "features/maintenance/eventing/event-log-retention.pipeline.ts",
  "features/maintenance/eventing/event-log-retention.process.ts",
];

const REFUSED = [
  "utils/parse-error-text.ts",
  "domain/event.ts",
  "adapters/postgres/prisma-process-store.ts",
  "server/adapters/clickhouse/event-repository.clickhouse.ts",
  "ports/lane.port.ts",
  "stores/event.store.ts",
  "helpers/keys.ts",
  "lib/lua.ts",
  "groupQueue.ts",
  "server/maintenance.ts",
  "eventing.module.ts",
  "transport/eventing.rest.ts",
  "migrations/legacy-import.process.migration.ts",
  "repositories/group-helpers.script.ts",
  "repositories/clickhouse/clickhouse.replay.script.ts",
  "features/keyspace/repositories/redis/stage.script.ts",
  "vocabulary/sub/event.ts",
  "vocabulary/event.types.ts",
  "telemetry/eventing.ts",
  "features/metrics/telemetry/group-queue.metrics.ts",
];

const NESTED_REFUSED = [
  "features/claim/features/retry/services/retry.service.ts",
  "features/claim/app/claim.app.ts",
  "features/claim/tasks/reap.task.ts",
  "features/claim/index.ts",
  "features/Claim/services/claimed-job.service.ts",
  "features/claim/services/sub/claimed-job.service.ts",
  "features/replay/channels/kafka/kafka.queue-activity.channel.ts",
];

const FRAMEWORK_ONLY = [
  "vocabulary/agent.ts",
  "telemetry/agent.metrics.ts",
  "repositories/redis/redis.agent.script.ts",
  "features/billing/channels/invoice.channel.ts",
  "features/billing/vocabulary/invoice.ts",
];

function hasHome(sourcePath) {
  return isFrameworkHome({ entry: false, sourcePath });
}

describe("given the closed framework allowlist", () => {
  describe("when a path names one of the allowed homes", () => {
    it("accepts every top-level home the message names", () => {
      expect(TOP_LEVEL.filter((path) => !hasHome(path))).toEqual([]);
    });

    it("accepts a concern's own services, repositories, channels, rules, eventing and vocabulary", () => {
      expect(NESTED.filter((path) => !hasHome(path))).toEqual([]);
      expect(FRAMEWORK_HOMES).toContain("features/<concern>/");
    });
  });

  describe("when a path names a folder the grammar closed", () => {
    it("refuses it and never names it in the message", () => {
      expect(REFUSED.filter(hasHome)).toEqual([]);
      for (const folder of ["ports/", "adapters/", "stores/", "utils/", "domain/", "server/"]) {
        expect(FRAMEWORK_HOMES).not.toContain(folder);
      }
    });

    it("refuses a second level and an app, task, index or unknown tier under a concern", () => {
      expect(NESTED_REFUSED.filter(hasHome)).toEqual([]);
    });
  });

  describe("when the package's exports name a file as an entry", () => {
    it("accepts that file wherever it sits and names entries in the message", () => {
      expect(isFrameworkHome({ entry: true, sourcePath: "server/index.ts" })).toBe(true);
      expect(isFrameworkHome({ entry: false, sourcePath: "server/index.ts" })).toBe(false);
      expect(FRAMEWORK_HOMES).toContain("`exports`");
    });
  });

  describe("when a module's process grammar reads a framework-only home", () => {
    it("still refuses it, so no module gains a home", () => {
      const processHome = (path) =>
        PROCESS_PATTERNS.some((pattern) => pattern.test(path)) || RULES_PATTERN.test(path);
      expect(FRAMEWORK_ONLY.filter(processHome)).toEqual([]);
      expect(FRAMEWORK_ONLY.filter((path) => !hasHome(path))).toEqual([]);
    });
  });
});

describe("given the script artifact", () => {
  it("is qualified by its tier and never ends a canonical name", () => {
    expect(QUALIFIED_ARTIFACTS.has("script")).toBe(true);
    expect(CANONICAL_ARTIFACTS.has("script")).toBe(false);
    expect(isLowerKebabFilename("redis.stage-batch.script.ts")).toBe(true);
    expect(claimedSubjects("repositories/redis/redis.stage-batch.script.ts")).toEqual([
      "stage-batch",
    ]);
  });
});

describe("given a package manifest", () => {
  describe("when it is read for the opt-in", () => {
    it("opts in only on layout features under the langwatch key", () => {
      expect(optsIntoFeatureLayout({ langwatch: { group: "framework", layout: "features" } })).toBe(
        true,
      );
      expect(optsIntoFeatureLayout({ langwatch: { group: "framework" } })).toBe(false);
      expect(optsIntoFeatureLayout({ langwatch: { layout: "flat" } })).toBe(false);
      expect(optsIntoFeatureLayout(undefined)).toBe(false);
    });
  });

  describe("when its exports are read for entry files", () => {
    it("collects every src target and skips dist, wildcards and other trees", () => {
      const exportsField = {
        ".": { types: "./dist/index.d.ts", default: "./src/index.ts" },
        "./testing": { types: "./dist/testing.d.ts", default: "./src/testing.ts" },
        "./server": { types: "./dist/server/index.d.ts", default: "./src/server/index.ts" },
        "./tables": { default: "./src/server/tables/event-table-declarations.ts" },
        "./grammar/*": "./grammar/*",
      };
      expect([...entrySourcePaths(exportsField)].toSorted()).toEqual([
        "index.ts",
        "server/index.ts",
        "server/tables/event-table-declarations.ts",
        "testing.ts",
      ]);
      expect([...entrySourcePaths("./src/index.ts")]).toEqual(["index.ts"]);
      expect([...entrySourcePaths(undefined)]).toEqual([]);
    });
  });
});
