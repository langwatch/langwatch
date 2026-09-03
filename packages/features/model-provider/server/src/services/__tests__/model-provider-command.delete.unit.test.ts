/**
 * Deleting a model provider — the authorization and the scope.
 *
 * A model provider holds a customer's own API credentials, so the delete has to
 * refuse three ways before it removes anything: without a tenant anchor to
 * resolve, without an organization behind that anchor, and without a provider
 * actually there. The one that carries the most weight is the fourth: the
 * actor is authorized against the scopes of the provider that was FOUND, not
 * against anything the caller sent, and the row is removed at that provider's
 * own organization.
 *
 * Only three of the nine collaborators take part in a delete, so the rest are
 * left unbuilt rather than stubbed into noise.
 */

import { describe, expect, it } from "vitest";
import {
  ModelProviderAnchorRequiredError,
  ModelProviderNotFoundError,
} from "@langwatch/model-provider-contract";
import { ModelProviderCommandService } from "../model-provider-command.service";

const EXISTING = {
  id: "provider-1",
  organizationId: "organization-1",
  provider: "openai",
  scopes: [{ kind: "project", id: "project-1" }],
};

function serviceWith(
  options: {
    anchor?: string | null;
    existing?: unknown;
    projectScopes?: unknown;
  } = {},
) {
  const deleted: unknown[] = [];
  const authorized: unknown[] = [];
  const repository = {
    tryFindById: async () => options.existing ?? null,
    tryFindByProviderForProject: async () => options.existing ?? null,
    delete: async (input: unknown) => {
      deleted.push(input);
    },
  };
  const scopes = {
    tryResolveAnchor: async () =>
      options.anchor === undefined ? "organization-1" : options.anchor,
    tryGetProjectScopes: async () => options.projectScopes ?? null,
  };
  const writeAuthorization = {
    assertCanWrite: async (actorId: string, providerScopes: unknown) => {
      authorized.push({ actorId, providerScopes });
    },
  };

  return {
    deleted,
    authorized,
    service: ModelProviderCommandService.create({
      repository,
      scopes,
      writeAuthorization,
    } as never),
  };
}

describe("ModelProviderCommandService.delete", () => {
  describe("given no tenant to anchor the delete to", () => {
    describe("when the delete is attempted", () => {
      it("refuses before reading anything", async () => {
        const { service, deleted } = serviceWith();

        await expect(service.delete({ provider: "openai" } as never)).rejects.toBeInstanceOf(
          ModelProviderAnchorRequiredError,
        );
        expect(deleted).toEqual([]);
      });
    });
  });

  describe("given an anchor that resolves to no organization", () => {
    describe("when the delete is attempted", () => {
      it("reports not-found and removes nothing", async () => {
        const { service, deleted } = serviceWith({ anchor: null });

        await expect(
          service.delete({ projectId: "project-1", provider: "openai" } as never),
        ).rejects.toBeInstanceOf(ModelProviderNotFoundError);
        expect(deleted).toEqual([]);
      });
    });
  });

  describe("given no provider of that id in the organization", () => {
    describe("when the delete is attempted", () => {
      it("reports not-found and removes nothing", async () => {
        const { service, deleted } = serviceWith({ existing: null });

        await expect(
          service.delete({
            projectId: "project-1",
            id: "provider-1",
            provider: "openai",
          } as never),
        ).rejects.toBeInstanceOf(ModelProviderNotFoundError);
        expect(deleted).toEqual([]);
      });
    });
  });

  describe("given a provider that is there", () => {
    describe("when an actor asks to delete it", () => {
      it("authorizes them against the found provider's scopes, not the request's", async () => {
        const { service, authorized } = serviceWith({ existing: EXISTING });

        await service.delete({
          projectId: "project-1",
          id: "provider-1",
          provider: "openai",
          actorId: "user-1",
        } as never);

        expect(authorized).toEqual([{ actorId: "user-1", providerScopes: EXISTING.scopes }]);
      });

      it("removes it at the organization the provider belongs to", async () => {
        const { service, deleted } = serviceWith({ existing: EXISTING });

        await service.delete({
          projectId: "project-1",
          id: "provider-1",
          provider: "openai",
          actorId: "user-1",
        } as never);

        expect(deleted).toEqual([
          { id: "provider-1", organizationId: "organization-1", projectId: "project-1" },
        ]);
      });
    });

    describe("when it was found through the project's scopes rather than by id", () => {
      // That lookup is not scoped by organization, so the provider it returns
      // can belong to one the anchor did not resolve to. The delete has to name
      // the provider's own organization; naming the resolved one would issue a
      // statement against a row that is not there.
      it("removes it at the provider's organization, not the resolved anchor's", async () => {
        const { service, deleted } = serviceWith({
          anchor: "organization-resolved",
          projectScopes: [{ kind: "project", id: "project-1" }],
          existing: { ...EXISTING, organizationId: "organization-owning" },
        });

        await service.delete({ projectId: "project-1", provider: "openai" } as never);

        expect(deleted).toEqual([
          {
            id: "provider-1",
            organizationId: "organization-owning",
            projectId: "project-1",
          },
        ]);
      });
    });

    describe("when no actor is named", () => {
      it("skips the authorization, which is what an internal caller relies on", async () => {
        const { service, authorized, deleted } = serviceWith({ existing: EXISTING });

        await service.delete({
          projectId: "project-1",
          id: "provider-1",
          provider: "openai",
        } as never);

        expect(authorized).toEqual([]);
        expect(deleted).toHaveLength(1);
      });
    });
  });
});
