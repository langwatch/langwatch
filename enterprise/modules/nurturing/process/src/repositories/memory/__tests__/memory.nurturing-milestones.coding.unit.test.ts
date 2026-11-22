// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * The Postgres twin's conditional writes for coding signals, held by the memory twin.
 * @see enterprise/modules/nurturing/specs/coding-agent-signals.feature
 */
import { describe, expect, it } from "vitest";

import { MAX_CODING_REPOSITORY_KEYS } from "../../nurturing-milestones.repository.ts";
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

  describe("when a day offset is added twice", () => {
    it("counts it once", async () => {
      const repository = await learned();
      const input = { organizationId: "org-1", dayOffset: 1 };

      await repository.addCodingSessionDayOffset(input);

      await expect(repository.addCodingSessionDayOffset(input)).resolves.toBe(1);
    });

    it("counts two offsets as two", async () => {
      const repository = await learned();

      await repository.addCodingSessionDayOffset({ organizationId: "org-1", dayOffset: 0 });

      await expect(
        repository.addCodingSessionDayOffset({ organizationId: "org-1", dayOffset: 2 }),
      ).resolves.toBe(2);
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
    it("returns the list the first time", async () => {
      const repository = await learned();

      await expect(
        repository.addCodingAgentType({ organizationId: "org-1", agentType: "claude_code" }),
      ).resolves.toEqual(["claude_code"]);
    });

    it("never duplicates the second time", async () => {
      const repository = await learned();
      await repository.addCodingAgentType({ organizationId: "org-1", agentType: "claude_code" });

      await expect(
        repository.addCodingAgentType({ organizationId: "org-1", agentType: "claude_code" }),
      ).resolves.toEqual(["claude_code"]);
    });

    it("extends the list with a second agent", async () => {
      const repository = await learned();
      await repository.addCodingAgentType({ organizationId: "org-1", agentType: "claude_code" });

      await expect(
        repository.addCodingAgentType({ organizationId: "org-1", agentType: "codex" }),
      ).resolves.toEqual(["claude_code", "codex"]);
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

  describe("when a terminal type is added twice", () => {
    it("holds it once", async () => {
      const repository = await learned();
      const input = { organizationId: "org-1", terminalType: "vscode" };

      await repository.addCodingTerminalType(input);

      await expect(repository.addCodingTerminalType(input)).resolves.toEqual(["vscode"]);
    });
  });

  describe("when a repo key is added twice", () => {
    it("counts it once", async () => {
      const repository = await learned();
      const input = { organizationId: "org-1", repositoryKey: "repo-a" };

      await repository.addCodingRepository(input);

      await expect(repository.addCodingRepository(input)).resolves.toBe(1);
    });
  });

  describe("when the organization already holds the most repo keys it may", () => {
    /** @scenario "The repo keys an organization holds stop at the cap" */
    it("holds no further key and keeps answering the count", async () => {
      const repository = await learned();
      for (let index = 0; index < MAX_CODING_REPOSITORY_KEYS; index++) {
        await repository.addCodingRepository({
          organizationId: "org-1",
          repositoryKey: `repo-${index}`,
        });
      }

      await expect(
        repository.addCodingRepository({ organizationId: "org-1", repositoryKey: "one-too-many" }),
      ).resolves.toBe(MAX_CODING_REPOSITORY_KEYS);
    });
  });

  describe("when the organization is not learned", () => {
    it("holds no terminal type and counts no repo", async () => {
      const repository = MemoryNurturingMilestonesRepository.create();

      await expect(
        repository.addCodingTerminalType({ organizationId: "org-x", terminalType: "vscode" }),
      ).resolves.toEqual([]);
      await expect(
        repository.addCodingRepository({ organizationId: "org-x", repositoryKey: "repo-a" }),
      ).resolves.toBe(0);
    });
  });
});
