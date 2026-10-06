// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { IngestionSourceNotFoundError } from "@langwatch/enterprise-governance-contract";
import { describe, expect, it, vi } from "vitest";

import { MemoryIngestionSourceRepository } from "../../repositories/memory/memory.ingestion-source.repository.ts";
import { SourceCredentialAccessService } from "../source-credential-access.service.ts";

async function buildWorld() {
  const sources = MemoryIngestionSourceRepository.create();
  const source = await sources.create({
    organizationId: "org_a",
    teamId: null,
    traceProjectId: null,
    sourceType: "copilot_studio",
    name: "Copilot",
    description: null,
    ingestSecretHash: "hash",
    parserConfig: { tenantId: "tenant-1", credentials: { clientSecret: "s3cret" } },
    pullSchedule: null,
    status: "awaiting_first_event",
    createdById: "user_1",
    providerAccountId: null,
  });
  const service = SourceCredentialAccessService.create({ sources });
  return { service, source };
}

describe("given a provider call for one source outside the scheduled pull", () => {
  describe("when the source belongs to the caller's organization", () => {
    it("hands the callback the credentials and a config without them", async () => {
      const { service, source } = await buildWorld();

      const seen = await service.withSourceCredentials({
        organizationId: "org_a",
        ingestionSourceId: source.id,
        use: async (context) => context,
      });

      expect(seen).toEqual({
        sourceId: source.id,
        sourceType: "copilot_studio",
        config: { tenantId: "tenant-1" },
        credentials: { clientSecret: "s3cret" },
      });
    });
  });

  describe("when the source belongs to another organization", () => {
    it("refuses as not found and never runs the callback", async () => {
      const { service, source } = await buildWorld();
      const use = vi.fn(async () => "called");

      await expect(
        service.withSourceCredentials({
          organizationId: "org_b",
          ingestionSourceId: source.id,
          use,
        }),
      ).rejects.toMatchObject({ code: new IngestionSourceNotFoundError(source.id).code });
      expect(use).not.toHaveBeenCalled();
    });
  });
});
