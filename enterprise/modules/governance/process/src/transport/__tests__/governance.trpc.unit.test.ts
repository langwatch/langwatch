// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * `governance.*` over the real tRPC runtime, pinned to main's wire
 * (platform/app/ee/governance/routers/governance.ts on origin/main).
 */
import { createApiFixture } from "@langwatch/api-fixture";
import type { GovernanceRestApi } from "@langwatch/enterprise-governance-contract";
import { describe, expect, it } from "vitest";

import { governanceTrpcTransport } from "../governance.trpc.ts";
import {
  governanceTrpcMembers,
  governanceTrpcRuntime,
  procedureKinds,
} from "./support/governance-trpc.fixture.ts";

const workspace = {
  userId: "user_2",
  displayName: "Ada",
  teamId: "team_1",
  projectId: "project_1",
  projectSlug: "ada-personal",
};

const setupState = {
  hasPersonalVKs: false,
  hasRoutingPolicies: false,
  hasIngestionSources: true,
  hasAnomalyRules: false,
  hasRecentActivity: false,
  hasApplicationTraces: false,
  governanceActive: true,
};
const home = {
  persona: "project_only" as const,
  destination: "/acme",
  isOverride: false,
  governanceUiEnabled: false,
  intentPinned: false,
  firstProjectSlug: "acme",
};
const emptyPage = { events: [], nextCursor: null, nextCursorCompound: null };

function mount(answer: typeof workspace | null) {
  const asked: string[] = [];
  const calls: unknown[] = [];
  const app = createApiFixture<GovernanceRestApi>({
    findActorWorkspace: async () => answer,
    governanceResolveHome: async (input, by) => {
      calls.push([input, by]);
      return home;
    },
    governanceSetupState: async (input) => {
      calls.push(input);
      return setupState;
    },
    governanceOcsfExport: async (input, by) => {
      calls.push([input, by]);
      return emptyPage;
    },
    governanceRecordWorkspaceView: async (input) => {
      calls.push(input);
      return { recorded: true, auditLogId: "audit_1" };
    },
    governanceQuarantineFillStats: async (input) => {
      calls.push(input);
      return {
        windowSeconds: 60,
        threshold: 100,
        spanCount: 0,
        rate: 0,
        exceeded: false,
        perSource: [],
      };
    },
  });
  const router = governanceTrpcRuntime(governanceTrpcMembers({ permits: () => true, asked })).mount(
    governanceTrpcTransport,
    () => app,
  );

  return { router, asked, calls, caller: router.createCaller({ actor: { id: "user_1" } }) };
}

describe("the governance tRPC namespace", () => {
  it("serves main's procedures as queries", () => {
    expect(procedureKinds(mount(null).router._def.procedures)).toEqual({
      resolveActorPersonalProject: "query",
      resolveHome: "query",
      setupState: "query",
      ocsfExport: "query",
      quarantineFillStats: "query",
      recordWorkspaceView: "mutation",
    });
  });

  it("resolves the caller's home under organization:view", async () => {
    const { caller, asked, calls } = mount(null);
    await expect(caller.resolveHome({ organizationId: "org_1" })).resolves.toEqual(home);
    expect(asked).toEqual(["organization:view"]);
    expect(calls).toEqual([[{ organizationId: "org_1" }, { id: "user_1" }]]);
  });

  it("answers the setup state under governance:view", async () => {
    const { caller, asked, calls } = mount(null);

    await expect(caller.setupState({ organizationId: "org_1" })).resolves.toEqual(setupState);
    expect(asked).toEqual(["governance:view"]);
    expect(calls).toEqual([{ organizationId: "org_1" }]);
  });

  it("pages the OCSF export under complianceExport:view from main's defaults", async () => {
    const { caller, asked, calls } = mount(null);

    await expect(caller.ocsfExport({ organizationId: "org_1" })).resolves.toEqual(emptyPage);
    expect(asked).toEqual(["complianceExport:view"]);
    expect(calls).toMatchObject([
      [{ organizationId: "org_1", sinceMs: 0, limit: 500 }, { id: "user_1" }],
    ]);
  });

  it("evaluates quarantine fill with main's default window and threshold", async () => {
    const { caller, calls } = mount(null);

    await caller.quarantineFillStats({ organizationId: "org_1" });
    expect(calls).toEqual([{ organizationId: "org_1", windowSeconds: 60, threshold: 100 }]);
  });

  it("answers the actor's personal workspace under governance:view", async () => {
    const { caller, asked } = mount(workspace);

    await expect(
      caller.resolveActorPersonalProject({ organizationId: "org_1", actor: "ada@example.com" }),
    ).resolves.toEqual(workspace);
    expect(asked).toEqual(["governance:view"]);
  });

  it("answers null when the actor resolves to nobody here, as main did", async () => {
    const { caller } = mount(null);

    await expect(
      caller.resolveActorPersonalProject({ organizationId: "org_1", actor: "nobody" }),
    ).resolves.toBeNull();
  });

  it("records the admin's workspace view as the caller under governance:view", async () => {
    const { caller, asked, calls } = mount(null);

    await expect(
      caller.recordWorkspaceView({ organizationId: "org_1", targetTeamId: "team_2", kind: "team" }),
    ).resolves.toEqual({ recorded: true, auditLogId: "audit_1" });
    expect(asked).toEqual(["governance:view"]);
    expect(calls).toEqual([
      { organizationId: "org_1", targetTeamId: "team_2", kind: "team", actorUserId: "user_1" },
    ]);
  });
});
