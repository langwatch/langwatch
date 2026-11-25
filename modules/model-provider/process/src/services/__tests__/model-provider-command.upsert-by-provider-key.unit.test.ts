// The project key's PUT names a provider by string: an existing row is updated, never duplicated.

import { ModelProviderNotFoundError } from "@langwatch/model-provider-contract";
import { describe, expect, it, vi } from "vitest";

import { ModelProviderCommandService } from "../model-provider-command.service.ts";

function serviceWith({ existingId }: { existingId?: string }) {
  const lookups: unknown[] = [];
  const repository = {
    getByProviderForProject: async (input: unknown) => {
      lookups.push(input);
      if (!existingId) throw new ModelProviderNotFoundError();
      return { id: existingId };
    },
  };
  const service = ModelProviderCommandService.create({ repository } as never);
  const upsert = vi.spyOn(service, "upsert").mockResolvedValue({} as never);

  return { service, upsert, lookups };
}

describe("ModelProviderCommandService.upsertByProviderKey", () => {
  describe("when the project already holds a row for the provider", () => {
    it("writes over that row's id, looked up at the project scope only", async () => {
      const { service, upsert, lookups } = serviceWith({ existingId: "provider-1" });

      await service.upsertByProviderKey({
        projectId: "project-1",
        provider: "openai",
        enabled: false,
      });

      expect(lookups).toEqual([
        { provider: "openai", projectScopes: [{ scopeType: "PROJECT", scopeId: "project-1" }] },
      ]);
      expect(upsert).toHaveBeenCalledWith(
        expect.objectContaining({ id: "provider-1", enabled: false }),
      );
    });
  });

  describe("when the project holds none", () => {
    it("writes without an id so a row is created", async () => {
      const { service, upsert } = serviceWith({});

      await service.upsertByProviderKey({
        projectId: "project-1",
        provider: "openai",
        enabled: true,
      });

      expect(upsert).toHaveBeenCalledWith({
        projectId: "project-1",
        provider: "openai",
        enabled: true,
      });
    });
  });
});
