// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * The Postgres twin's conditional writes for coding signals, held by the memory twin.
 * @see enterprise/modules/nurturing/specs/coding-agent-signals.feature
 */
import { describe, expect, it } from "vitest";

import { MemoryNurturingMilestonesRepository } from "../memory.nurturing-milestones.repository.ts";

async function learned() {
  const repository = MemoryNurturingMilestonesRepository.create();
  await repository.recordOrganization({
    organizationId: "org-1",
    adminUserId: "admin-1",
    seeded: false,
  });
  return repository;
}

describe("MemoryNurturingMilestonesRepository coding signals", () => {
  describe("when the first coding session is recorded twice", () => {
    it("reports first for the first call only", async () => {
      const repository = await learned();

      const results = [
        await repository.recordCodingFirstSession({ organizationId: "org-1", occurredAt: 100 }),
        await repository.recordCodingFirstSession({ organizationId: "org-1", occurredAt: 200 }),
      ];

      expect(results).toEqual([{ first: true }, { first: false }]);
    });

    /** @scenario "A delivery that fails before it is claimed is not lost when the fact is redelivered" */
    it("reports first again for a retry of the fact that set it", async () => {
      const repository = await learned();
      await repository.recordCodingFirstSession({ organizationId: "org-1", occurredAt: 100 });

      await expect(
        repository.recordCodingFirstSession({ organizationId: "org-1", occurredAt: 100 }),
      ).resolves.toEqual({ first: true });
    });

    it("keeps the first call's time", async () => {
      const repository = await learned();

      await repository.recordCodingFirstSession({ organizationId: "org-1", occurredAt: 100 });
      await repository.recordCodingFirstSession({ organizationId: "org-1", occurredAt: 200 });

      expect(
        (await repository.findOrganization({ organizationId: "org-1" }))[0]?.codingFirstSessionAt,
      ).toBe(100);
    });
  });

  describe("when the organization is not learned", () => {
    it("reports no first session", async () => {
      const repository = MemoryNurturingMilestonesRepository.create();

      await expect(
        repository.recordCodingFirstSession({ organizationId: "org-x", occurredAt: 1 }),
      ).resolves.toEqual({ first: false });
    });
  });

  describe("when an agent type is added", () => {
    it("reports a change and the list the first time", async () => {
      const repository = await learned();

      await expect(
        repository.addCodingAgentType({ organizationId: "org-1", agentType: "claude_code" }),
      ).resolves.toEqual({ changed: true, codingAgentTypes: ["claude_code"] });
    });

    it("reports no change and never duplicates the second time", async () => {
      const repository = await learned();
      await repository.addCodingAgentType({ organizationId: "org-1", agentType: "claude_code" });

      await expect(
        repository.addCodingAgentType({ organizationId: "org-1", agentType: "claude_code" }),
      ).resolves.toEqual({ changed: false, codingAgentTypes: ["claude_code"] });
    });

    it("extends the list with a second agent", async () => {
      const repository = await learned();
      await repository.addCodingAgentType({ organizationId: "org-1", agentType: "claude_code" });

      await expect(
        repository.addCodingAgentType({ organizationId: "org-1", agentType: "codex" }),
      ).resolves.toEqual({ changed: true, codingAgentTypes: ["claude_code", "codex"] });
    });
  });

  describe("when active days are recorded", () => {
    it("counts the first day as one", async () => {
      const repository = await learned();

      await expect(
        repository.recordCodingActiveDay({ organizationId: "org-1", day: "2026-10-20" }),
      ).resolves.toEqual({ changed: true, codingActiveDays: 1 });
    });

    it("counts the same day once and answers it again as changed", async () => {
      const repository = await learned();
      await repository.recordCodingActiveDay({ organizationId: "org-1", day: "2026-10-20" });

      await expect(
        repository.recordCodingActiveDay({ organizationId: "org-1", day: "2026-10-20" }),
      ).resolves.toEqual({ changed: true, codingActiveDays: 1 });
    });

    it("counts a later day", async () => {
      const repository = await learned();
      await repository.recordCodingActiveDay({ organizationId: "org-1", day: "2026-10-20" });

      await expect(
        repository.recordCodingActiveDay({ organizationId: "org-1", day: "2026-10-23" }),
      ).resolves.toEqual({ changed: true, codingActiveDays: 2 });
    });

    it("ignores a late earlier day", async () => {
      const repository = await learned();
      await repository.recordCodingActiveDay({ organizationId: "org-1", day: "2026-10-23" });

      await expect(
        repository.recordCodingActiveDay({ organizationId: "org-1", day: "2026-10-22" }),
      ).resolves.toEqual({ changed: false, codingActiveDays: 1 });
    });
  });
});
