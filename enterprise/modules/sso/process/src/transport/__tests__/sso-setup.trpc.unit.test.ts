// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * What an organization's own administrator reads about its connection
 * (specs/identity/sso-connection-history.feature).
 */
import { createTrpcRuntime, type TrpcRuntimeMembers } from "@langwatch/api/trpc";
import { initTRPC } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import {
  createSsoTestApp,
  createSsoTestIdentity,
  RecordingSsoConnectionLedger,
  RecordingSsoDomainCeremony,
} from "../../app/__tests__/sso.fixture.ts";
import { ssoSetupTrpcTransport } from "../sso-setup.trpc.ts";

type TestContext = { actor: { id: string } };

function runtimePorts(permits: (permission: string) => boolean): TrpcRuntimeMembers<TestContext> {
  return {
    identity: { caller: (ctx) => ({ actor: { type: "user", id: ctx.actor.id } }) },
    authorization: {
      forRequest: () => ({
        getDecision: async ({ permission }) => ({
          permitted: permits(permission),
          organizationRole: null,
        }),
        getProjectAnyDecision: async ({ permissions }) => ({
          permitted: permissions.some((permission) => permits(permission)),
          organizationRole: null,
        }),
        checkScopeLineage: async () => ({ kind: "consistent" }),
      }),
    },
    denials: {
      membershipDisabled: () => new Error("membership disabled"),
      liteMemberRestricted: () => new Error("lite member"),
    },
    audit: { record: async () => {}, redact: ({ args }) => args, exempt: () => false },
    errors: {
      report: () => {},
      asError: (failure) => (failure instanceof Error ? failure : new Error(String(failure))),
      translate: () => undefined,
    },
  };
}

const ENTRY = {
  eventId: "evt_1",
  occurredAtMs: 1_764_000_000_000,
  summary: "Ana registered Okta as the identity provider.",
  carriedOver: false,
};

async function harness(options: { permits?: (permission: string) => boolean } = {}) {
  const connections = RecordingSsoConnectionLedger.create();
  const getHistory = vi.fn(async () => [ENTRY]);
  const ceremony = RecordingSsoDomainCeremony.create();
  const auditLog = { record: vi.fn(async () => {}), listEntityHistory: vi.fn() };
  const app = await createSsoTestApp({
    connections,
    dependencies: {
      auditLog,
      identity: createSsoTestIdentity(connections, { getHistory }, ceremony),
    },
  });
  const trpc = initTRPC.context<TestContext>().create();
  const router = createTrpcRuntime<TestContext>({
    root: trpc,
    procedure: trpc.procedure,
    members: runtimePorts(options.permits ?? (() => true)),
  }).mount(ssoSetupTrpcTransport, () => app);

  return {
    auditLog,
    ceremony,
    getHistory,
    router,
    caller: router.createCaller({ actor: { id: "user_ana" } }),
  };
}

const TARGET = { organizationId: "org_acme", connectionId: "ssoc_1" };

describe("the organization's own single sign-on surface", () => {
  describe("given the mounted router", () => {
    it("exposes the history read, its signal, and the domain ceremony", async () => {
      const { router } = await harness();

      expect(Object.keys(router._def.procedures).toSorted()).toEqual([
        "checkDomainFile",
        "checkDomainRecord",
        "claimDomain",
        "getHistory",
        "onHistoryActivity",
        "proveDomain",
        "removeDomain",
      ]);
    });
  });

  describe("given an administrator of the organization", () => {
    it("answers the connection's history in the words identity composed", async () => {
      const { caller, getHistory } = await harness();

      await expect(caller.getHistory(TARGET)).resolves.toEqual([ENTRY]);
      expect(getHistory).toHaveBeenCalledWith(TARGET);
    });
  });

  describe("given the live signal behind the same panel", () => {
    /** @scenario "The live subscription is gated exactly like the read it refreshes" */
    it("is refused to the same reader the history itself refuses", async () => {
      const { caller } = await harness({
        permits: (permission) => permission === "sso:view",
      });

      const refusal = await Promise.resolve(caller.onHistoryActivity(TARGET))
        .then(async (stream) => {
          await stream[Symbol.asyncIterator]().next();
          return null;
        })
        .catch((error: unknown) => error);

      expect(refusal).toMatchObject({ code: "FORBIDDEN" });
    });
  });

  describe("given a reader who may see single sign-on but not manage it", () => {
    /** @scenario "Seeing the history takes managing single sign-on, not only seeing it" */
    it("refuses, because the history is nearer an audit trail than a state", async () => {
      const { caller, getHistory } = await harness({
        permits: (permission) => permission === "sso:view",
      });

      await expect(caller.getHistory(TARGET)).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(getHistory).not.toHaveBeenCalled();
    });
  });

  describe("given an administrator running the domain ceremony", () => {
    /** @scenario "The ceremony names the administrator the surface authenticated" */
    it("names the session administrator on the fact, never an id from the input", async () => {
      const { caller, ceremony } = await harness();

      await expect(caller.claimDomain({ ...TARGET, domain: "acme.test" })).resolves.toEqual({
        waitsForReview: false,
        disputed: false,
      });
      expect(ceremony.claimDomain).toHaveBeenCalledWith({
        ...TARGET,
        domain: "acme.test",
        actor: { userId: "user_ana" },
      });
    });

    it("answers the record to publish, with the value identity issued once", async () => {
      const { caller } = await harness();

      await expect(caller.proveDomain({ ...TARGET, domain: "acme.test" })).resolves.toMatchObject({
        proved: false,
        record: { domain: "acme.test", value: "langwatch-domain-proof=token" },
      });
    });

    /** @scenario "The attempt is on the trail even when the ceremony refuses" */
    it("records the attempt before the ceremony runs, so a refusal is still on the trail", async () => {
      const { auditLog, caller, ceremony } = await harness();
      ceremony.checkDomainRecord.mockRejectedValueOnce(new Error("nothing published yet"));

      await expect(caller.checkDomainRecord({ ...TARGET, domain: "acme.test" })).rejects.toThrow(
        "nothing published yet",
      );

      expect(auditLog.record).toHaveBeenCalledWith({
        userId: "user_ana",
        organizationId: "org_acme",
        action: "ssoSetup.checkDomainRecord",
        args: { ...TARGET, domain: "acme.test" },
        targetKind: "ssoConnection",
        targetId: "ssoc_1",
      });
    });
  });

  describe("given that same reader at the ceremony", () => {
    /** @scenario "Running the ceremony takes managing single sign-on, not only seeing it" */
    it("refuses every verb of it, and runs none of it", async () => {
      const { caller, ceremony } = await harness({
        permits: (permission) => permission === "sso:view",
      });

      await expect(caller.removeDomain({ ...TARGET, domain: "acme.test" })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await expect(
        caller.checkDomainFile({ ...TARGET, domain: "acme.test" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(ceremony.removeDomain).not.toHaveBeenCalled();
      expect(ceremony.checkDomainFile).not.toHaveBeenCalled();
    });
  });
});
