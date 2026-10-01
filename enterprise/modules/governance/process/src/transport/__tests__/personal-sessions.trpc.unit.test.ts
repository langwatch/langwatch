// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * `personalSessions.*` over the real tRPC runtime, pinned to
 * main's wire (platform/app/ee/governance/routers/personalSessions.ts on origin/main).
 */
import { createApiFixture } from "@langwatch/api-fixture";
import { bindTrpcFact, browserSessionFact } from "@langwatch/api/trpc";
import type { GovernanceRestApi } from "@langwatch/enterprise-governance-contract";
import { describe, expect, it } from "vitest";

import { personalSessionsTrpcTransport } from "../personal-sessions.trpc.ts";
import {
  governanceTrpcMembers,
  governanceTrpcRuntime,
  procedureKinds,
} from "./support/governance-trpc.fixture.ts";

const revocation = { ok: true, revokedTokens: 2, revokedKeys: 1 };

function mount() {
  const asked: string[] = [];
  const calls: unknown[] = [];
  const app = createApiFixture<GovernanceRestApi>({
    cliSessionListForUser: async (input) => {
      calls.push(input);
      return [];
    },
    cliSessionRevoke: async (input) => {
      calls.push(input);
      return revocation;
    },
    personalWebSessionList: async (input) => {
      calls.push(input);
      return [];
    },
    personalWebSessionEnd: async (input) => {
      calls.push(input);
      return { ended: 1 };
    },
    personalWebSessionsEndForIdentifier: async (input) => {
      calls.push(input);
      return { ended: 2 };
    },
  });
  const router = governanceTrpcRuntime(governanceTrpcMembers({ permits: () => true, asked })).mount(
    personalSessionsTrpcTransport,
    () => app,
    { facts: [bindTrpcFact(browserSessionFact, () => "session_current")] },
  );
  return { router, asked, calls, caller: router.createCaller({ actor: { id: "user_1" } }) };
}

describe("the personalSessions tRPC namespace", () => {
  it("serves main's CLI session procedures with main's kinds", () => {
    expect(procedureKinds(mount().router._def.procedures)).toEqual({
      list: "query",
      revoke: "mutation",
      revokeAll: "mutation",
      listWebSessions: "query",
      revokeWebSession: "mutation",
      revokeWebSessionsForIdentifier: "mutation",
    });
  });

  it("lists the caller's own sessions under organization:view", async () => {
    const { caller, asked, calls } = mount();

    await expect(caller.list({ organizationId: "org_1" })).resolves.toEqual([]);
    expect(asked).toEqual(["organization:view"]);
    expect(calls).toEqual([{ userId: "user_1" }]);
  });

  it("revokes one of the caller's sessions and answers main's counts", async () => {
    const { caller, calls } = mount();

    await expect(
      caller.revoke({ organizationId: "org_1", sessionStartedAtMs: 100 }),
    ).resolves.toEqual(revocation);
    expect(calls).toEqual([{ userId: "user_1", sessionStartedAtMs: 100 }]);
  });

  it("lists the caller's own web sessions, marking the current one, with no permission asked", async () => {
    const { caller, asked, calls } = mount();

    await expect(caller.listWebSessions({})).resolves.toEqual([]);
    expect(asked).toEqual([]);
    expect(calls).toEqual([{ userId: "user_1", currentSessionId: "session_current" }]);
  });

  it("ends one of the caller's web sessions, naming the session doing the asking", async () => {
    const { caller, asked, calls } = mount();

    await expect(caller.revokeWebSession({ sessionId: "session_2" })).resolves.toEqual({
      ended: 1,
    });
    expect(asked).toEqual([]);
    expect(calls).toEqual([
      { userId: "user_1", sessionId: "session_2", currentSessionId: "session_current" },
    ]);
  });

  it("ends the caller's web sessions one identifier minted", async () => {
    const { caller, asked, calls } = mount();

    await expect(
      caller.revokeWebSessionsForIdentifier({ identifierId: "identifier_1" }),
    ).resolves.toEqual({ ended: 2 });
    expect(asked).toEqual([]);
    expect(calls).toEqual([{ userId: "user_1", identifierId: "identifier_1" }]);
  });

  it("refuses an empty identifier before the application is reached", async () => {
    const { caller, calls } = mount();

    await expect(caller.revokeWebSessionsForIdentifier({ identifierId: "" })).rejects.toMatchObject(
      {
        code: "BAD_REQUEST",
      },
    );
    expect(calls).toEqual([]);
  });
});
