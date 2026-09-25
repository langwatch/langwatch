// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * `governancePeople.*` over the real tRPC runtime, pinned to main's wire
 * (platform/app/ee/governance/routers/governancePeople.ts on origin/main).
 */
import { createApiFixture } from "@langwatch/api-fixture";
import type { GovernanceRestApi } from "@langwatch/enterprise-governance-contract";
import { describe, expect, it } from "vitest";

import { governancePeopleTrpcTransport } from "../governance-people.trpc.ts";
import {
  governanceTrpcMembers,
  governanceTrpcRuntime,
  procedureKinds,
} from "./support/governance-trpc.fixture.ts";

const SEEN = new Date("2026-09-01T00:00:00.000Z");

function mount(permits: (permission: string) => boolean = () => true) {
  const asked: string[] = [];
  const calls: unknown[] = [];
  const app = createApiFixture<GovernanceRestApi>({
    governancePeopleList: async (input) => {
      calls.push(input);
      return [
        {
          id: "person_1",
          provider: "anthropic",
          kind: "user",
          displayText: "ada@example.com",
          rawActorId: "actor_1",
          directoryDepartment: null,
          firstSeenAt: SEEN,
          lastSeenAt: SEEN,
          erasedAt: null,
          suspendedAt: null,
          suspendedReason: null,
          link: null,
        },
      ];
    },
    governancePeopleSuggestions: async (input) => {
      calls.push(input);
      return [];
    },
    governancePeopleRunMatch: async (input) => {
      calls.push(input);
      return { linked: 2, suspended: 1, unproven: 3 };
    },
    governancePeopleConfirmSuggestion: async (input) => {
      calls.push(input);
      return { discoveredPersonId: "person_1", userId: "user_2" };
    },
  });
  const router = governanceTrpcRuntime(governanceTrpcMembers({ permits, asked })).mount(
    governancePeopleTrpcTransport,
    () => app,
  );
  return { router, asked, calls, caller: router.createCaller({ actor: { id: "user_1" } }) };
}

describe("the governancePeople tRPC namespace", () => {
  it("serves main's four procedure names", () => {
    expect(procedureKinds(mount().router._def.procedures)).toEqual({
      list: "query",
      suggestions: "query",
      runMatch: "mutation",
      confirmSuggestion: "mutation",
    });
  });

  it("reads the people under governance:view, dates intact", async () => {
    const { caller, asked } = mount();

    const people = await caller.list({ organizationId: "org_1" });

    expect(people[0]?.lastSeenAt).toEqual(SEEN);
    expect(asked).toEqual(["governance:view"]);
  });

  it("reads the suggestions under governance:view", async () => {
    const { caller, asked } = mount();

    await expect(caller.suggestions({ organizationId: "org_1" })).resolves.toEqual([]);
    expect(asked).toEqual(["governance:view"]);
  });

  it("runs the match under governance:manage and answers main's three counts", async () => {
    const { caller, asked } = mount();

    await expect(caller.runMatch({ organizationId: "org_1" })).resolves.toEqual({
      linked: 2,
      suspended: 1,
      unproven: 3,
    });
    expect(asked).toEqual(["governance:manage"]);
  });

  it("confirms a suggestion under governance:manage", async () => {
    const { caller, asked, calls } = mount();

    await expect(
      caller.confirmSuggestion({ organizationId: "org_1", suggestionId: "sug_1" }),
    ).resolves.toEqual({ discoveredPersonId: "person_1", userId: "user_2" });
    expect(asked).toEqual(["governance:manage"]);
    expect(calls).toEqual([{ organizationId: "org_1", suggestionId: "sug_1" }]);
  });

  it("refuses a writer without governance:manage", async () => {
    const { caller, calls } = mount(() => false);

    await expect(caller.runMatch({ organizationId: "org_1" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(calls).toEqual([]);
  });
});
