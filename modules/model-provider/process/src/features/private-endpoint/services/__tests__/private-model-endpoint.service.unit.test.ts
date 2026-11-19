import { ValidationError } from "@langwatch/handled-error";
import { PrivateModelEndpointNotFoundError } from "@langwatch/model-provider-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { beforeEach, describe, expect, it } from "vitest";

import { MemoryPrivateModelEndpointRepository } from "../../../../repositories/memory/memory.private-model-endpoint.repository.ts";
import { PrivateModelEndpointService } from "../private-model-endpoint.service.ts";

const ACME = "org_acme";
const RIVAL = "org_rival";
const STAFF = "user_staff";
const MANAGER = "user_manager";

const PROJECT_ORGANIZATION: Record<string, string> = { "acme-prod": ACME, "rival-prod": RIVAL };

function createService(): PrivateModelEndpointService {
  let next = 0;
  return PrivateModelEndpointService.create({
    repository: MemoryPrivateModelEndpointRepository.create(),
    ids: { generate: ({ type }) => `${type}_${++next}` },
    projects: createApiFixture<ProjectApi>({
      findOrganizationId: async (projectId: string) => PROJECT_ORGANIZATION[projectId],
    }),
  });
}

describe("PrivateModelEndpointService", () => {
  let service: PrivateModelEndpointService;
  let inferenceId: string;

  beforeEach(async () => {
    service = createService();
    const inference = await service.register({
      organizationId: ACME,
      name: "Inference",
      region: "eu-west-1",
      addresses: ["10.20.1.21", "10.20.2.34"],
      port: 443,
      actorId: STAFF,
    });
    inferenceId = inference.id;
    await service.bind({
      organizationId: ACME,
      endpointId: inferenceId,
      hostname: "LLM.internal.acme.test.",
      actorId: MANAGER,
    });
  });

  describe("given Acme bound a hostname to its endpoint", () => {
    describe("when a model call for an Acme project reads its bindings", () => {
      it("carries the hostname with the registered addresses and port", async () => {
        expect(await service.bindingsForProject({ projectId: "acme-prod" })).toEqual([
          {
            hostname: "llm.internal.acme.test",
            addresses: ["10.20.1.21", "10.20.2.34"],
            port: 443,
          },
        ]);
      });
    });

    describe("when a model call for an unknown project reads its bindings", () => {
      it("carries none", async () => {
        expect(await service.bindingsForProject({ projectId: "nobody" })).toEqual([]);
      });
    });

    describe("when Acme's managers list their endpoints", () => {
      /** @scenario "The settings page shows endpoints without their addresses" */
      it("shows the name, region, status and hostnames, and never the addresses or port", async () => {
        const listed = await service.listForOrganization({ organizationId: ACME });

        expect(listed).toEqual([
          {
            id: inferenceId,
            name: "Inference",
            region: "eu-west-1",
            status: "in_use",
            bindings: [expect.objectContaining({ hostname: "llm.internal.acme.test" })],
          },
        ]);
        expect(JSON.stringify(listed)).not.toContain("10.20.");
      });
    });

    describe("when the same hostname is bound twice in Acme", () => {
      it("refuses the second binding on the hostname field", async () => {
        const refusal = await service
          .bind({
            organizationId: ACME,
            endpointId: inferenceId,
            hostname: "llm.internal.acme.test",
            actorId: MANAGER,
          })
          .catch((error: unknown) => error);

        expect(refusal).toBeInstanceOf(ValidationError);
        expect((refusal as ValidationError).meta?.fieldErrors).toHaveProperty("hostname");
      });
    });
  });

  describe("given Rival has its own endpoint", () => {
    let gatewayId: string;

    beforeEach(async () => {
      gatewayId = (
        await service.register({
          organizationId: RIVAL,
          name: "Gateway",
          region: "us-east-1",
          addresses: ["10.20.3.5"],
          port: 443,
          actorId: STAFF,
        })
      ).id;
    });

    describe("when an Acme manager binds a hostname to Rival's endpoint", () => {
      /** @scenario "A customer cannot bind to another organization's endpoint" */
      it("answers not found and saves nothing", async () => {
        const refusal = await service
          .bind({
            organizationId: ACME,
            endpointId: gatewayId,
            hostname: "llm.acme.test",
            actorId: MANAGER,
          })
          .catch((error: unknown) => error);

        expect(refusal).toBeInstanceOf(PrivateModelEndpointNotFoundError);
        expect(await service.bindingsForOrganization({ organizationId: ACME })).toHaveLength(1);
      });

      it("answers not found when Acme names Rival's endpoint to change or remove it", async () => {
        const edit = { organizationId: ACME, endpointId: gatewayId };
        const update = await service
          .update({ ...edit, name: "x", region: "x", addresses: ["10.0.0.1"], port: 443 })
          .catch((error: unknown) => error);
        const remove = await service.remove(edit).catch((error: unknown) => error);

        expect(update).toBeInstanceOf(PrivateModelEndpointNotFoundError);
        expect(remove).toBeInstanceOf(PrivateModelEndpointNotFoundError);
      });
    });

    describe("when both organizations bind the same hostname", () => {
      /** @scenario "Two organizations bind the same hostname to their own endpoints" */
      it("gives each organization's calls its own endpoint's addresses", async () => {
        await service.bind({
          organizationId: RIVAL,
          endpointId: gatewayId,
          hostname: "llm.internal.acme.test",
          actorId: MANAGER,
        });

        const rival = await service.bindingsForProject({ projectId: "rival-prod" });
        const acme = await service.bindingsForProject({ projectId: "acme-prod" });

        expect(rival).toEqual([
          { hostname: "llm.internal.acme.test", addresses: ["10.20.3.5"], port: 443 },
        ]);
        expect(JSON.stringify(rival)).not.toContain("10.20.1.21");
        expect(acme[0]?.addresses).toEqual(["10.20.1.21", "10.20.2.34"]);
      });
    });

    describe("when Rival has bound nothing", () => {
      it("gives Rival's calls no binding at all", async () => {
        expect(await service.bindingsForOrganization({ organizationId: RIVAL })).toEqual([]);
      });
    });
  });

  describe("given an organization manager removes the binding", () => {
    /** @scenario "Removing a binding closes the path for the next call" */
    it("leaves the next call with no binding for that hostname", async () => {
      const [endpoint] = await service.listForOrganization({ organizationId: ACME });
      await service.unbind({ organizationId: ACME, bindingId: endpoint!.bindings[0]!.id });

      expect(await service.bindingsForProject({ projectId: "acme-prod" })).toEqual([]);
      expect((await service.listForOrganization({ organizationId: ACME }))[0]?.status).toBe(
        "unbound",
      );
    });
  });

  describe("given staff remove the endpoint", () => {
    /** @scenario "Removing a private endpoint closes every binding to it" */
    it("removes every binding to it, so the next call has none", async () => {
      await service.bind({
        organizationId: ACME,
        endpointId: inferenceId,
        hostname: "llm.acme.test",
        actorId: MANAGER,
      });

      await service.remove({ organizationId: ACME, endpointId: inferenceId });

      expect(await service.bindingsForProject({ projectId: "acme-prod" })).toEqual([]);
      expect(await service.listForStaff({ organizationId: ACME })).toEqual([]);
    });
  });

  describe("given staff change the endpoint's addresses", () => {
    it("carries the new addresses on the next call, still bound to the same hostname", async () => {
      await service.update({
        organizationId: ACME,
        endpointId: inferenceId,
        name: "Inference",
        region: "eu-west-1",
        addresses: ["10.20.9.1"],
        port: 8443,
      });

      expect(await service.bindingsForOrganization({ organizationId: ACME })).toEqual([
        { hostname: "llm.internal.acme.test", addresses: ["10.20.9.1"], port: 8443 },
      ]);
    });
  });

  describe("given staff register an endpoint with a public address", () => {
    it("saves nothing", async () => {
      const refusal = await service
        .register({
          organizationId: RIVAL,
          name: "Bad",
          region: "x",
          addresses: ["8.8.8.8"],
          port: 443,
          actorId: STAFF,
        })
        .catch((error: unknown) => error);

      expect(refusal).toBeInstanceOf(ValidationError);
      expect(await service.listForStaff({ organizationId: RIVAL })).toEqual([]);
    });
  });
});
