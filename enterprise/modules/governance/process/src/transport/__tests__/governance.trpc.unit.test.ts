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

function mount(answer: typeof workspace | null) {
  const asked: string[] = [];
  const app = createApiFixture<GovernanceRestApi>({ findActorWorkspace: async () => answer });
  const router = governanceTrpcRuntime(governanceTrpcMembers({ permits: () => true, asked })).mount(
    governanceTrpcTransport,
    () => app,
  );

  return { router, asked, caller: router.createCaller({ actor: { id: "user_1" } }) };
}

describe("the governance tRPC namespace", () => {
  it("serves resolveActorPersonalProject as a query", () => {
    expect(procedureKinds(mount(null).router._def.procedures)).toEqual({
      resolveActorPersonalProject: "query",
    });
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
});
