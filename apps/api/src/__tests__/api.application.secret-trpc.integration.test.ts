/**
 * `secrets.*`, served by the API process over the feature's own declared
 * transport. The namespace is in the packaged record now rather than mounted on
 * the root, so what this suite proves is that a caller reaches ONE application
 * through the record's own policy chain.
 */
import type { AgentApi } from "@langwatch/agent-contract";
import type { AuthzGetDecisionInput } from "@langwatch/authz-contract";
import { SecretNotFoundError, type Secret, type SecretApi } from "@langwatch/secret-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiApplication } from "../api.application.ts";
import { ApiTrpcFeaturesComposition } from "../app/api-trpc-features.composition.ts";
import type { ApiTrpcInfrastructure } from "../platform/infrastructure/api-trpc.infrastructure.ts";
import {
  stub,
  stubCollaborators,
  stubComposedFeatures,
  stubInfrastructureEntitlements,
} from "../app/__tests__/api-trpc-record.test-doubles.ts";
import { createSecretTrpcRouter } from "../features/secret/secret-trpc.mount.ts";

const secret: Secret = {
  id: "secret-1",
  projectId: "project-1",
  name: "MY_SECRET",
  createdAt: new Date("2026-08-28T00:00:00.000Z"),
  updatedAt: new Date("2026-08-28T00:00:00.000Z"),
  createdBy: { name: "Alex" },
  updatedBy: { name: "Alex" },
};

/** The one application every caller below reaches, with each call recorded. */
function testSecrets() {
  const calls = {
    list: vi.fn(async () => [secret]),
    get: vi.fn(async () => secret),
    getValues: vi.fn(async () => ({})),
    create: vi.fn(async () => secret),
    update: vi.fn(async () => secret),
    delete: vi.fn(async () => undefined),
  };
  return { calls, app: createApiFixture<SecretApi>(calls, "secrets") };
}

/**
 * Composes the record over one secret application. `permitted` decides every
 * declared check, so a scenario can put the refusal before the dispatch.
 */
function composeApplication(options: { secrets: SecretApi; permitted?: boolean }) {
  const getDecision = vi.fn(async (_input: AuthzGetDecisionInput) => ({
    permitted: options.permitted ?? true,
    organizationRole: null,
  }));
  const authz = createApiFixture<ApiTrpcInfrastructure["authz"]>({
    getDecision,
    getProjectAnyDecision: async () => ({ permitted: true, organizationRole: null }),
    checkScopeLineage: async () => ({ kind: "consistent" as const }),
    hasPermission: async () => options.permitted ?? true,
  });
  const infrastructure = {
    ...stubInfrastructureEntitlements(),
    prisma: stub<ApiTrpcInfrastructure["prisma"]>("infrastructure.prisma"),
    authz,
    audit: undefined,
  };
  const features = ApiTrpcFeaturesComposition.tryCompose({
    composed: {
      ...stubComposedFeatures(),
      secret: {
        app: options.secrets,
        rest: [],
        routers: (mount) => ({ secrets: createSecretTrpcRouter(mount.runtime) }),
      },
    },
    infrastructure,
    collaborators: stubCollaborators({ secrets: options.secrets }),
  });
  if (!features) throw new Error("the record refused to compose against its collaborators");

  const application = ApiApplication.create({
    agents: createApiFixture<AgentApi>(),
    features,
  });

  return {
    getDecision,
    caller: application.createCaller({
      actor: () => ({ id: "user-1" }),
      tryActor: () => ({ id: "user-1" }),
      authorize: async () => undefined,
      session: { user: { id: "user-1", name: "Alex", email: "alex@acme.test", role: "ADMIN" } },
    }),
  };
}

describe("given an API process composed with the secret feature", () => {
  describe("when the read and the create are called", () => {
    it("preserves the list and create shapes and checks each declared permission", async () => {
      const { calls, app } = testSecrets();
      const { caller, getDecision } = composeApplication({ secrets: app });

      await expect(caller.secrets.list({ projectId: "project-1" })).resolves.toEqual([secret]);
      await expect(
        caller.secrets.create({
          projectId: "project-1",
          name: "MY_SECRET",
          value: "secret-value",
        }),
      ).resolves.toEqual(secret);

      expect(getDecision.mock.calls[0]?.[0]).toMatchObject({ permission: "secrets:view" });
      expect(getDecision.mock.calls[1]?.[0]).toMatchObject({ permission: "secrets:manage" });
      expect(calls.list).toHaveBeenCalledWith({ projectId: "project-1" });
      expect(calls.create).toHaveBeenCalledWith(
        { projectId: "project-1", name: "MY_SECRET", value: "secret-value" },
        { id: "user-1" },
      );
    });
  });

  describe("when the two by-id writes are called", () => {
    it("preserves their inputs and their acknowledged responses", async () => {
      const { calls, app } = testSecrets();
      const { caller } = composeApplication({ secrets: app });

      await expect(
        caller.secrets.update({
          projectId: "project-1",
          secretId: "secret-1",
          value: "rotated-value",
        }),
      ).resolves.toEqual({ success: true });
      await expect(
        caller.secrets.delete({ projectId: "project-1", secretId: "secret-1" }),
      ).resolves.toEqual({ success: true });

      expect(calls.update).toHaveBeenCalledWith(
        { projectId: "project-1", id: "secret-1", value: "rotated-value" },
        { id: "user-1" },
      );
      expect(calls.delete).toHaveBeenCalledWith({ projectId: "project-1", id: "secret-1" });
    });
  });

  describe("when the caller may not read the project", () => {
    it("stops before the application is reached", async () => {
      const { calls, app } = testSecrets();
      const { caller } = composeApplication({ secrets: app, permitted: false });

      await expect(caller.secrets.list({ projectId: "project-1" })).rejects.toThrow();
      expect(calls.list).not.toHaveBeenCalled();
    });
  });

  describe("when a write carries an input the declaration refuses", () => {
    it("refuses before authorization and before the application", async () => {
      const { calls, app } = testSecrets();
      const { caller, getDecision } = composeApplication({ secrets: app });

      await expect(
        caller.secrets.update({ projectId: "project-1", secretId: "secret-1", value: "" }),
      ).rejects.toMatchObject({ code: "UNPROCESSABLE_CONTENT" });
      expect(getDecision).not.toHaveBeenCalled();
      expect(calls.update).not.toHaveBeenCalled();
    });
  });

  describe("when two callers are created from one process", () => {
    it("reaches one composed application from both", async () => {
      const { calls, app } = testSecrets();
      const first = composeApplication({ secrets: app });
      const second = composeApplication({ secrets: app });

      await first.caller.secrets.list({ projectId: "project-1" });
      await second.caller.secrets.list({ projectId: "project-2" });

      expect(calls.list).toHaveBeenCalledTimes(2);
      expect(calls.list).toHaveBeenNthCalledWith(1, { projectId: "project-1" });
      expect(calls.list).toHaveBeenNthCalledWith(2, { projectId: "project-2" });
    });
  });

  describe("when the application raises a handled domain error", () => {
    it("maps it at the process boundary", async () => {
      const { calls, app } = testSecrets();
      const error = new SecretNotFoundError();
      calls.update.mockRejectedValueOnce(error);
      const { caller } = composeApplication({ secrets: app });

      await expect(
        caller.secrets.update({
          projectId: "project-1",
          secretId: "secret-1",
          value: "rotated-value",
        }),
      ).rejects.toMatchObject({ code: "NOT_FOUND", cause: error });
    });
  });

  describe("when a schema parse fails inside the application", () => {
    /** @scenario
     * "A schema parse inside a service is a validation failure on the application spine too"
     */
    it("promotes it to validation_error", async () => {
      const { calls, app } = testSecrets();
      const parsed = z.object({ value: z.string().min(1) }).safeParse({ value: "" });
      if (parsed.success) throw new Error("fixture parsed");
      calls.update.mockRejectedValueOnce(parsed.error);
      const { caller } = composeApplication({ secrets: app });

      await expect(
        caller.secrets.update({
          projectId: "project-1",
          secretId: "secret-1",
          value: "rotated-value",
        }),
      ).rejects.toMatchObject({
        code: "UNPROCESSABLE_CONTENT",
        message: "validation_error",
        cause: { code: "validation_error" },
      });
    });
  });
});
