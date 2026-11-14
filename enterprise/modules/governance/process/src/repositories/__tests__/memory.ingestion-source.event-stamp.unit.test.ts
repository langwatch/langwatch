// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * The received-event stamp on the memory twin: it makes a waiting source active and never
 * re-enables one an admin disabled while a batch was in flight. The Prisma backend runs the
 * same cases in `prisma/__tests__/prisma.ingestion-source.event-stamp.integration.test.ts`.
 * Spec: specs/ai-gateway/governance/ingestion-sources.feature
 */
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryIngestionSourceRepository } from "../memory/memory.ingestion-source.repository.ts";

const NOW = Date.parse("2026-11-13T10:00:00.000Z");
const STAMPED_AT = Temporal.Instant.fromEpochMilliseconds(NOW);

async function sourceIn(repository: MemoryIngestionSourceRepository) {
  return repository.create({
    organizationId: "org-1",
    teamId: null,
    traceProjectId: null,
    sourceType: "otel_generic",
    name: "OTel",
    description: null,
    ingestSecretHash: "hash",
    parserConfig: {},
    pullSchedule: null,
    status: "awaiting_first_event",
    createdById: "user-1",
    providerAccountId: null,
  });
}

describe("MemoryIngestionSourceRepository.recordEventReceived", () => {
  describe("given a source still awaiting its first event", () => {
    /** @scenario "The first batch a source receives makes it active" */
    it("makes it active and stamps the last event time", async () => {
      const repository = MemoryIngestionSourceRepository.create({ now: () => NOW });
      const source = await sourceIn(repository);

      await repository.recordEventReceived(source.id, STAMPED_AT);

      const stored = await repository.findById(source.id);
      expect(stored?.status).toBe("active");
      expect(stored?.lastEventAt).toEqual(new Date(NOW));
    });
  });

  describe("given the admin disabled the source after its batch was let in", () => {
    /** @scenario "A batch in flight when the source is disabled does not re-enable it" */
    it("leaves the source disabled and its last event time alone", async () => {
      const repository = MemoryIngestionSourceRepository.create({ now: () => NOW });
      const source = await sourceIn(repository);
      await repository.update(source.id, { status: "disabled" });

      await repository.recordEventReceived(source.id, STAMPED_AT);

      const stored = await repository.findById(source.id);
      expect(stored?.status).toBe("disabled");
      expect(stored?.lastEventAt).toBeNull();
    });
  });
});
