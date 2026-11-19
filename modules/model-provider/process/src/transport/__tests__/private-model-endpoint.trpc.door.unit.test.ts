/**
 * @vitest-environment node
 * `privateModelEndpoint.*` behind the real tRPC door (ADR-203): organization managers bind, staff
 * holding ops:manage register, everyone else is refused before the application. Spec:
 * specs/security/org-private-model-endpoints.feature.
 */
import {
  createTrpcRuntime,
  redactAuditArgs,
  TrpcRootDefinition,
  type TrpcRuntimeAuditEntry,
  type TrpcRuntimeMembers,
} from "@langwatch/api/trpc";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { testAuthorizeDefaults } from "@langwatch/test-harness/trpc-members";
import { describe, expect, it } from "vitest";

import { PrivateModelEndpointService } from "../../features/private-endpoint/services/private-model-endpoint.service.ts";
import { MemoryPrivateModelEndpointRepository } from "../../repositories/memory/memory.private-model-endpoint.repository.ts";
import { privateModelEndpointTrpcTransport } from "../private-model-endpoint.trpc.ts";

type Context = { actor: { type: "user"; id: string } | null };

const ACME = "org_acme";
const RIVAL = "org_rival";

/** Organization grants by user and organization; platform grants by user. */
const ORGANIZATION_GRANTS: Readonly<Record<string, Readonly<Record<string, string[]>>>> = {
  "user-manager": { [ACME]: ["organization:manage"] },
  "user-member": { [ACME]: ["organization:view"] },
};
const PLATFORM_GRANTS: Readonly<Record<string, readonly string[]>> = {
  "user-staff": ["ops:view", "ops:manage"],
  "user-viewer": ["ops:view"],
};

const root = TrpcRootDefinition.forContext<Context>().create({});

function members(audited: TrpcRuntimeAuditEntry[]): TrpcRuntimeMembers<Context> {
  return {
    identity: { caller: (ctx) => ({ actor: ctx.actor }) },
    authorization: {
      forRequest: () => ({
        ...testAuthorizeDefaults,
        getDecision: async ({ userId, permission, scope }) => {
          const granted =
            scope.tier === "organization" ? (ORGANIZATION_GRANTS[userId]?.[scope.id] ?? []) : [];
          return { permitted: granted.includes(permission), organizationRole: null };
        },
        getProjectAnyDecision: async () => ({ permitted: false, organizationRole: null }),
        checkScopeLineage: async () => ({ kind: "consistent" }),
        getPlatformDecision: async ({ userId, permission }) => ({
          permitted: (PLATFORM_GRANTS[userId] ?? []).includes(permission),
        }),
      }),
    },
    denials: {
      membershipDisabled: () => new Error("membership disabled"),
      liteMemberRestricted: () => new Error("lite member"),
    },
    audit: {
      record: async (entry) => {
        audited.push(entry);
      },
      redact: ({ procedure, args }) => redactAuditArgs({ input: args, action: procedure }),
      exempt: () => false,
    },
    errors: {
      report: () => {},
      asError: (failure) => (failure instanceof Error ? failure : new Error(String(failure))),
      translate: () => undefined,
    },
  };
}

/** The door over the real service on an in-memory store, so a refusal provably saved nothing. */
function privateEndpointsDoor() {
  let next = 0;
  const service = PrivateModelEndpointService.create({
    repository: MemoryPrivateModelEndpointRepository.create(),
    ids: { generate: ({ type }) => `${type}_${++next}` },
    projects: createApiFixture<ProjectApi>({}),
  });
  const app = createApiFixture<ModelProviderApi>({
    listPrivateEndpointsForOrganization: (input) => service.listForOrganization(input),
    bindPrivateEndpointHostname: (input, by) => service.bind({ ...input, actorId: by.id }),
    rebindPrivateEndpointHostname: (input) => service.rebind(input),
    unbindPrivateEndpointHostname: (input) => service.unbind(input),
    listPrivateEndpointsForStaff: (input) => service.listForStaff(input),
    registerPrivateEndpoint: (input, by) => service.register({ ...input, actorId: by.id }),
    updatePrivateEndpoint: (input) => service.update(input),
    removePrivateEndpoint: (input) => service.remove(input),
  });
  const audited: TrpcRuntimeAuditEntry[] = [];
  const runtime = createTrpcRuntime<Context>({
    root,
    procedure: root.procedure,
    members: members(audited),
  });
  // Nested under its namespace as the app mounts it, so the audit row names the full path.
  const router = root.router({
    privateModelEndpoint: runtime.mount(privateModelEndpointTrpcTransport, () => app),
  });
  const as = (id: string | null) =>
    router.createCaller({ actor: id ? { type: "user", id } : null }).privateModelEndpoint;

  return { as, service, audited };
}

function codeOf(failure: unknown): string {
  return (failure as { code?: string }).code ?? "resolved";
}

const INFERENCE = {
  organizationId: ACME,
  name: "Inference",
  region: "eu-west-1",
  addresses: ["10.20.1.21", "10.20.2.34"],
  port: 443,
};

describe("the privateModelEndpoint tRPC namespace", () => {
  describe("given staff holding ops:manage", () => {
    describe("when they register an endpoint for an organization", () => {
      /** @scenario "Staff register a private endpoint in ops" */
      it("saves it for that organization and records it against the organization with their identity", async () => {
        const { as, service, audited } = privateEndpointsDoor();

        const endpoint = await as("user-staff").register(INFERENCE);

        expect(endpoint).toMatchObject({ organizationId: ACME, addresses: INFERENCE.addresses });
        expect(await service.listForStaff({ organizationId: ACME })).toHaveLength(1);
        expect(audited).toEqual([
          expect.objectContaining({
            userId: "user-staff",
            organizationId: ACME,
            action: "privateModelEndpoint.register",
            targetKind: "private_model_endpoint",
            targetId: endpoint.id,
          }),
        ]);
        expect(JSON.stringify(audited[0]?.args)).not.toContain("10.20.");
      });
    });
  });

  describe("given someone who is not staff", () => {
    /** @scenario "A customer cannot create or change a private endpoint" */
    it("answers every ops procedure not-found and saves nothing, even for an organization manager", async () => {
      const { as, service } = privateEndpointsDoor();
      const manager = as("user-manager");
      const edit = { ...INFERENCE, endpointId: "private_endpoint_1" };

      const refusals = await Promise.all([
        manager.register(INFERENCE).catch((error: unknown) => error),
        manager.update(edit).catch((error: unknown) => error),
        manager.remove({ organizationId: ACME, endpointId: "x" }).catch((error: unknown) => error),
        manager.listForStaff({ organizationId: ACME }).catch((error: unknown) => error),
      ]);

      expect(refusals.map(codeOf)).toEqual(["NOT_FOUND", "NOT_FOUND", "NOT_FOUND", "NOT_FOUND"]);
      expect(await service.listForStaff({ organizationId: ACME })).toEqual([]);
    });

    it("refuses a view-only operator's writes by name", async () => {
      const { as } = privateEndpointsDoor();

      const refusal = await as("user-viewer")
        .register(INFERENCE)
        .catch((error: unknown) => error);

      expect(codeOf(refusal)).toBe("FORBIDDEN");
    });
  });

  describe("given an organization manager", () => {
    /** @scenario "An organization manager binds a hostname" */
    it("binds a hostname, records it with their identity, and the next call carries it", async () => {
      const { as, service, audited } = privateEndpointsDoor();
      const endpoint = await service.register({ ...INFERENCE, actorId: "user-staff" });

      const binding = await as("user-manager").bind({
        organizationId: ACME,
        endpointId: endpoint.id,
        hostname: "llm.acme.test",
      });

      expect(binding.hostname).toBe("llm.acme.test");
      expect(audited).toEqual([
        expect.objectContaining({
          userId: "user-manager",
          organizationId: ACME,
          action: "privateModelEndpoint.bind",
        }),
      ]);
      expect(await service.bindingsForOrganization({ organizationId: ACME })).toEqual([
        { hostname: "llm.acme.test", addresses: INFERENCE.addresses, port: 443 },
      ]);
    });

    /** @scenario "The binding API has no way to set an address" */
    it("refuses a binding that names an address, and the endpoint keeps its own", async () => {
      const { as, service } = privateEndpointsDoor();
      const endpoint = await service.register({ ...INFERENCE, actorId: "user-staff" });

      const refusal = await as("user-manager")
        .bind({
          organizationId: ACME,
          endpointId: endpoint.id,
          hostname: "llm.acme.test",
          addresses: ["10.20.9.9"],
        } as never)
        .catch((error: unknown) => error);

      expect(codeOf(refusal)).toBe("BAD_REQUEST");
      expect(await service.bindingsForOrganization({ organizationId: ACME })).toEqual([]);
      expect((await service.listForStaff({ organizationId: ACME }))[0]?.addresses).toEqual(
        INFERENCE.addresses,
      );
    });

    /** @scenario "A customer cannot bind to another organization's endpoint" */
    it("answers another organization's endpoint not-found", async () => {
      const { as, service } = privateEndpointsDoor();
      const gateway = await service.register({
        ...INFERENCE,
        organizationId: RIVAL,
        addresses: ["10.20.3.5"],
        actorId: "user-staff",
      });

      const refusal = await as("user-manager")
        .bind({ organizationId: ACME, endpointId: gateway.id, hostname: "llm.acme.test" })
        .catch((error: unknown) => error);

      expect(codeOf(refusal)).toBe("NOT_FOUND");
      expect(await service.bindingsForOrganization({ organizationId: ACME })).toEqual([]);
    });

    it("cannot bind in an organization it does not manage", async () => {
      const { as, service } = privateEndpointsDoor();
      const gateway = await service.register({
        ...INFERENCE,
        organizationId: RIVAL,
        actorId: "user-staff",
      });

      const refusal = await as("user-manager")
        .bind({ organizationId: RIVAL, endpointId: gateway.id, hostname: "llm.acme.test" })
        .catch((error: unknown) => error);

      expect(codeOf(refusal)).toBe("FORBIDDEN");
      expect(await service.bindingsForOrganization({ organizationId: RIVAL })).toEqual([]);
    });

    it("reads its endpoints without their addresses", async () => {
      const { as, service } = privateEndpointsDoor();
      await service.register({ ...INFERENCE, actorId: "user-staff" });

      const listed = await as("user-manager").listForOrganization({ organizationId: ACME });

      expect(listed).toHaveLength(1);
      expect(JSON.stringify(listed)).not.toContain("10.20.");
    });
  });

  describe("given a member without organization:manage", () => {
    /** @scenario "A member without organization:manage cannot change bindings" */
    it("is refused as forbidden on every binding procedure and saves nothing", async () => {
      const { as, service } = privateEndpointsDoor();
      const endpoint = await service.register({ ...INFERENCE, actorId: "user-staff" });
      const member = as("user-member");

      const refusals = await Promise.all([
        member
          .bind({ organizationId: ACME, endpointId: endpoint.id, hostname: "llm.acme.test" })
          .catch((error: unknown) => error),
        member
          .rebind({
            organizationId: ACME,
            bindingId: "b",
            endpointId: endpoint.id,
            hostname: "llm.acme.test",
          })
          .catch((error: unknown) => error),
        member.unbind({ organizationId: ACME, bindingId: "b" }).catch((error: unknown) => error),
        member.listForOrganization({ organizationId: ACME }).catch((error: unknown) => error),
      ]);

      expect(refusals.map(codeOf)).toEqual(["FORBIDDEN", "FORBIDDEN", "FORBIDDEN", "FORBIDDEN"]);
      expect(await service.bindingsForOrganization({ organizationId: ACME })).toEqual([]);
    });
  });
});
