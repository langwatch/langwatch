import { describe, expect, it } from "vitest";

import { countGroupsByStatus, filterGroups, tenantScopeOf } from "../queue-pipeline-utils.ts";
import type { OpsQueueGroup } from "../queue-presentation.ts";

const NOW = 1_000_000;

const group = (groupId: string, fields: Partial<OpsQueueGroup> = {}): OpsQueueGroup => ({
  groupId,
  pendingJobs: 1,
  score: NOW - 1,
  hasActiveJob: false,
  activeJobId: null,
  isBlocked: false,
  oldestJobMs: null,
  newestJobMs: null,
  isStaleBlock: false,
  pipelineName: null,
  jobType: null,
  jobName: null,
  errorMessage: null,
  errorStack: null,
  errorTimestamp: null,
  retryCount: null,
  activeKeyTtlSec: null,
  processingDurationMs: null,
  ...fields,
});

const groups = [
  group("project_a/due", { pendingJobs: 3, pipelineName: "Traces" }),
  group("project_a/blocked", { isBlocked: true, errorMessage: "Boom" }),
  group("project_b/stale", { isStaleBlock: true, isBlocked: true }),
  group("project_b/active", { hasActiveJob: true, activeJobId: "j" }),
  group("project_c/retry", { retryCount: 2, score: NOW + 5, errorMessage: "Timeout" }),
];

const ids = (list: OpsQueueGroup[]) => list.map((g) => g.groupId);

describe("filterGroups", () => {
  it("sorts every group by severity under the all filter and a blank search", () => {
    expect(ids(filterGroups({ groups, statusFilter: "all", search: "  ", now: NOW }))).toEqual([
      "project_a/blocked",
      "project_b/stale",
      "project_c/retry",
      "project_a/due",
      "project_b/active",
    ]);
  });

  it.each([
    ["blocked", "", ["project_a/blocked"]],
    ["retrying", "", ["project_c/retry"]],
    ["all", "TRACES", ["project_a/due"]],
    ["all", "boom", ["project_a/blocked"]],
    ["all", "project_b", ["project_b/stale", "project_b/active"]],
    ["ok", "project_a", ["project_a/due"]],
  ] as const)("filters %s with search %j", (statusFilter, search, expected) => {
    expect(ids(filterGroups({ groups, statusFilter, search, now: NOW }))).toEqual(expected);
  });
});

describe("countGroupsByStatus", () => {
  it("counts each status over the whole set", () => {
    expect(countGroupsByStatus(groups, NOW)).toEqual({
      all: 5,
      ok: 2,
      blocked: 1,
      stale: 1,
      active: 1,
      retrying: 1,
    });
  });
});

describe("tenantScopeOf", () => {
  it.each([
    ["project_abc", "project_abc"],
    ["  project_abc  ", "project_abc"],
    ["project_abc/group", null],
    ["project_a b", null],
    ["tenant_x", null],
    ["", null],
  ])("scopes %j to %j", (search, expected) => {
    expect(tenantScopeOf(search)).toBe(expected);
  });
});
