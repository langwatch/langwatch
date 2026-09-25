// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * `ingestionSources.*` over the real tRPC runtime, pinned to main's wire
 * (platform/app/ee/governance/routers/ingestionSources.ts on origin/main).
 */
import { createApiFixture } from "@langwatch/api-fixture";
import type {
  GovernanceRestApi,
  IngestionSourceDto,
} from "@langwatch/enterprise-governance-contract";
import { describe, expect, it } from "vitest";

import { ingestionSourcesTrpcTransport } from "../ingestion-sources.trpc.ts";
import {
  governanceTrpcMembers,
  governanceTrpcRuntime,
  procedureKinds,
} from "./support/governance-trpc.fixture.ts";

const at = new Date(0);
const source: IngestionSourceDto = {
  id: "src_1",
  organizationId: "org_1",
  teamId: null,
  sourceType: "otel_generic",
  name: "Collector",
  description: null,
  parserConfig: {},
  hasPollerCursor: false,
  pullSchedule: null,
  status: "awaiting_first_event",
  errorCount: 0,
  lastSuccessAt: null,
  lastReadThroughAt: null,
  lastRunCompleteness: null,
  pullStatus: { lastRunAt: null, outcome: null, error: null, backfillThrough: null, hasMore: null },
  traceProjectId: null,
  traceProjectArchived: false,
  lastEventAt: null,
  archivedAt: null,
  createdAt: at,
  updatedAt: at,
  createdById: "user_1",
};

function mount() {
  const asked: string[] = [];
  const calls: unknown[] = [];
  const record = <T>(input: unknown, answer: T): T => {
    calls.push(input);
    return answer;
  };
  const app = createApiFixture<GovernanceRestApi>({
    ingestionSourceList: async (input) => record(input, [source]),
    ingestionSourceGet: async (input) => record(input, source),
    ingestionSourceCreate: async (input) => record(input, { source, ingestSecret: "lw_is_1" }),
    ingestionSourceUpdate: async (input) => record(input, source),
    ingestionSourceRotateSecret: async (input) =>
      record(input, { source, ingestSecret: "lw_is_2" }),
    ingestionSourceArchive: async (input) => record(input, source),
    ingestionSourceOttlStarter: (input) =>
      record(input, { enabled: true, statements: [], enabledSourceTypes: ["otel_generic"] }),
  });
  const router = governanceTrpcRuntime(governanceTrpcMembers({ permits: () => true, asked })).mount(
    ingestionSourcesTrpcTransport,
    () => app,
  );
  return { router, asked, calls, caller: router.createCaller({ actor: { id: "user_1" } }) };
}

const target = { organizationId: "org_1", id: "src_1" };

describe("the ingestionSources tRPC namespace", () => {
  it("serves main's procedures with main's kinds", () => {
    expect(procedureKinds(mount().router._def.procedures)).toEqual({
      list: "query",
      get: "query",
      create: "mutation",
      update: "mutation",
      rotateSecret: "mutation",
      archive: "mutation",
      ottlStarter: "query",
    });
  });

  it("reads under ingestionSources:view", async () => {
    const { caller, asked } = mount();
    await expect(caller.list({ organizationId: "org_1" })).resolves.toEqual([source]);
    await expect(caller.get(target)).resolves.toEqual(source);
    await caller.ottlStarter({ organizationId: "org_1", sourceType: "otel_generic" });
    expect(asked).toEqual([
      "ingestionSources:view",
      "ingestionSources:view",
      "ingestionSources:view",
    ]);
  });

  it("creates as the caller under ingestionSources:manage, answering the secret once", async () => {
    const { caller, asked, calls } = mount();
    await expect(
      caller.create({ organizationId: "org_1", sourceType: "otel_generic", name: "Collector" }),
    ).resolves.toEqual({ source, ingestSecret: "lw_is_1" });
    expect(asked).toEqual(["ingestionSources:manage"]);
    expect(calls).toEqual([
      {
        organizationId: "org_1",
        sourceType: "otel_generic",
        name: "Collector",
        actorUserId: "user_1",
      },
    ]);
  });

  it("refuses a name longer than main's 128 characters", async () => {
    const { caller } = mount();
    await expect(
      caller.create({ organizationId: "org_1", sourceType: "otel_generic", name: "x".repeat(129) }),
    ).rejects.toThrow();
  });

  it("updates, rotates and archives under ingestionSources:manage", async () => {
    const { caller, asked } = mount();
    await caller.update({ ...target, status: "disabled" });
    await expect(caller.rotateSecret(target)).resolves.toEqual({ source, ingestSecret: "lw_is_2" });
    await caller.archive(target);
    expect(asked).toEqual([
      "ingestionSources:manage",
      "ingestionSources:manage",
      "ingestionSources:manage",
    ]);
  });
});
