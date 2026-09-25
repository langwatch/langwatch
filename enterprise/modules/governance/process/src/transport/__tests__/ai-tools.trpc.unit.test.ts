// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * `aiTools.*` over the real tRPC runtime, pinned to main's wire
 * (platform/app/ee/governance/routers/aiTools.ts on origin/main).
 */
import { createApiFixture } from "@langwatch/api-fixture";
import type {
  AiToolEntry,
  GovernanceRestApi,
  UpdateAiToolEntryInput,
} from "@langwatch/enterprise-governance-contract";
import { describe, expect, it } from "vitest";

import { aiToolsTrpcTransport } from "../ai-tools.trpc.ts";
import {
  governanceTrpcMembers,
  governanceTrpcRuntime,
  procedureKinds,
} from "./support/governance-trpc.fixture.ts";

const entry: AiToolEntry = {
  id: "tile_1",
  organizationId: "org_1",
  scope: "organization",
  scopeId: "org_1",
  departmentIds: [],
  type: "external_tool",
  displayName: "Wiki",
  slug: "wiki",
  iconKey: null,
  iconAsset: null,
  order: 0,
  enabled: true,
  config: { descriptionMarkdown: "hi", linkUrl: "https://wiki.test" },
  archivedAtMs: null,
  createdAtMs: 1,
  updatedAtMs: 1,
  createdById: null,
  updatedById: null,
};

function mount(permits: (permission: string) => boolean = () => true) {
  const asked: string[] = [];
  const calls: unknown[] = [];
  const updates: UpdateAiToolEntryInput[] = [];
  const app = createApiFixture<GovernanceRestApi>({
    aiToolListForUser: async (input) => {
      calls.push(input);
      return [entry];
    },
    aiToolUpdate: async (input) => {
      updates.push(input);
      return entry;
    },
    aiToolReorder: async (input) => {
      calls.push(input);
    },
    aiToolClaudeCodeOtlpEndpoint: async () => ({ endpoint: null }),
  });
  const router = governanceTrpcRuntime(governanceTrpcMembers({ permits, asked })).mount(
    aiToolsTrpcTransport,
    () => app,
  );

  return {
    router,
    asked,
    calls,
    updates,
    caller: router.createCaller({ actor: { id: "user_1" } }),
  };
}

describe("the aiTools tRPC namespace", () => {
  it("serves main's fourteen procedure names with main's query and mutation kinds", () => {
    expect(procedureKinds(mount().router._def.procedures)).toEqual({
      list: "query",
      providerAvailability: "query",
      claudeCodeOtlpEndpoint: "query",
      adminList: "query",
      get: "query",
      create: "mutation",
      update: "mutation",
      remove: "mutation",
      setEnabled: "mutation",
      importStarterPack: "mutation",
      starterPackCatalog: "query",
      providerOptions: "query",
      routingPolicyOptions: "query",
      reorder: "mutation",
    });
  });

  it("lists the caller's own portal tiles under aiTools:view", async () => {
    const { caller, asked, calls } = mount();

    await expect(caller.list({ organizationId: "org_1" })).resolves.toEqual([entry]);
    expect(asked).toEqual(["aiTools:view"]);
    expect(calls).toEqual([{ organizationId: "org_1", userId: "user_1" }]);
  });

  it("answers a null endpoint while no Claude Code source is published", async () => {
    const { caller } = mount((permission) => permission === "aiTools:view");

    await expect(caller.claudeCodeOtlpEndpoint({ organizationId: "org_1" })).resolves.toEqual({
      endpoint: null,
    });
  });

  describe("when an admin toggles a tile", () => {
    it("writes only the enabled flag, attributed to the caller", async () => {
      const { caller, asked, updates } = mount();

      await caller.setEnabled({ organizationId: "org_1", id: "tile_1", enabled: false });

      expect(asked).toEqual(["aiTools:manage"]);
      expect(updates).toEqual([
        { organizationId: "org_1", id: "tile_1", enabled: false, actorUserId: "user_1" },
      ]);
    });
  });

  describe("when an admin reorders the catalogue", () => {
    it("answers main's acknowledgement", async () => {
      const { caller } = mount();

      await expect(
        caller.reorder({ organizationId: "org_1", updates: [{ id: "tile_1", order: 2 }] }),
      ).resolves.toEqual({ ok: true });
    });

    it("refuses an empty reorder as main's input did", async () => {
      const { caller, calls } = mount();

      await expect(caller.reorder({ organizationId: "org_1", updates: [] })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
      expect(calls).toEqual([]);
    });
  });

  describe("given a member without aiTools:manage", () => {
    it("refuses get, as main gated it on aiTools:manage", async () => {
      const { caller } = mount((permission) => permission === "aiTools:view");

      await expect(caller.get({ organizationId: "org_1", id: "tile_1" })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    });
  });
});
