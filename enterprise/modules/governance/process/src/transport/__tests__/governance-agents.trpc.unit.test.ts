// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * `governanceAgents.*` over the real tRPC runtime, pinned to main's wire
 * (platform/app/ee/governance/routers/governanceAgents.ts on origin/main).
 */
import { createApiFixture } from "@langwatch/api-fixture";
import {
  AgentListingUnavailableError,
  type GovernanceRestApi,
} from "@langwatch/enterprise-governance-contract";
import { describe, expect, it } from "vitest";

import { governanceAgentsTrpcTransport } from "../governance-agents.trpc.ts";
import {
  governanceTrpcMembers,
  governanceTrpcRuntime,
  procedureKinds,
} from "./support/governance-trpc.fixture.ts";

const SOURCE = { id: "src_1", name: "Anthropic", sourceType: "anthropic_admin" };
const ROW = {
  id: "registered:agent_1",
  name: "support-copilot",
  environment: "production",
  owner: null,
  models: [],
  source: "custom" as const,
  costUsd30d: null,
  requests30d: null,
  lastActiveMinutesAgo: 60,
  health: null,
  registeredDaysAgo: 90,
};

function mount(options: { permits?: (permission: string) => boolean; unavailable?: boolean } = {}) {
  const asked: string[] = [];
  const calls: unknown[] = [];
  const app = createApiFixture<GovernanceRestApi>({
    governanceAgentsList: async (input) => {
      calls.push(input);
      return [ROW];
    },
    governanceAgentsSyncSources: async (input) => {
      calls.push(input);
      return [{ ...SOURCE, lastListing: { outcome: "refused", cause: "access" } }];
    },
    governanceAgentsRequestListing: async (input) => {
      calls.push(input);
      if (options.unavailable) throw new AgentListingUnavailableError("event_sourcing_disabled");
      return { requested: 1, sources: [SOURCE] };
    },
  });
  const permits = options.permits ?? (() => true);
  const router = governanceTrpcRuntime(governanceTrpcMembers({ permits, asked })).mount(
    governanceAgentsTrpcTransport,
    () => app,
  );
  return { router, asked, calls, caller: router.createCaller({ actor: { id: "user_1" } }) };
}

describe("the governanceAgents tRPC namespace", () => {
  it("serves main's sync procedures", () => {
    expect(procedureKinds(mount().router._def.procedures)).toEqual({
      list: "query",
      syncSources: "query",
      requestListing: "mutation",
    });
  });

  it("lists the organization's agents under governance:view", async () => {
    const { caller, asked, calls } = mount();

    await expect(caller.list({ organizationId: "org_1" })).resolves.toEqual([ROW]);
    expect(asked).toEqual(["governance:view"]);
    expect(calls).toEqual([{ organizationId: "org_1" }]);
  });

  it("reads the listable sources and their last listing under governance:view", async () => {
    const { caller, asked } = mount();

    await expect(caller.syncSources({ organizationId: "org_1" })).resolves.toEqual([
      { ...SOURCE, lastListing: { outcome: "refused", cause: "access" } },
    ]);
    expect(asked).toEqual(["governance:view"]);
  });

  it("asks under governance:manage and answers what it asked", async () => {
    const { caller, asked, calls } = mount();

    await expect(caller.requestListing({ organizationId: "org_1" })).resolves.toEqual({
      requested: 1,
      sources: [SOURCE],
    });
    expect(asked).toEqual(["governance:manage"]);
    expect(calls).toEqual([{ organizationId: "org_1" }]);
  });

  it("refuses by code where listings cannot run", async () => {
    const { caller } = mount({ unavailable: true });

    await expect(caller.requestListing({ organizationId: "org_1" })).rejects.toMatchObject({
      cause: { code: "agent_listing_unavailable" },
    });
  });

  it("refuses an asker without governance:manage", async () => {
    const { caller, calls } = mount({ permits: () => false });

    await expect(caller.requestListing({ organizationId: "org_1" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(calls).toEqual([]);
  });
});
