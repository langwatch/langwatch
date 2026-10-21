// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * What nurturing decides from coding-agent's session-stored fact: the first-session guard, the
 * agent-type union and the UTC-day count, in that order, each guarded in the repository.
 * @see enterprise/modules/nurturing/specs/coding-agent-signals.feature
 */
import type { CodingAgentSessionStoredEventData } from "@langwatch/coding-agent-contract";
import type { NurturingSignal } from "@langwatch/enterprise-nurturing-contract";
import { beforeEach, describe, expect, it } from "vitest";

import { MemoryNurturingMilestonesRepository } from "../../repositories/memory/memory.nurturing-milestones.repository.ts";
import { MemoryNurturingProjectDirectoryRepository } from "../../repositories/memory/memory.nurturing-project-directory.repository.ts";
import { NurturingCodingMilestonesService } from "../nurturing-coding-milestones.service.ts";

const DAY = Date.UTC(2026, 9, 20, 12);
const HOUR = 60 * 60 * 1000;

const fact = (
  over: Partial<CodingAgentSessionStoredEventData> = {},
): CodingAgentSessionStoredEventData => ({
  tenantId: "project-1",
  projectId: "project-1",
  sessionId: "session-1",
  agentType: "claude_code",
  firstForProject: true,
  occurredAt: DAY,
  ...over,
});

async function serviceOver({
  adminUserId = "admin-1",
  seeded = false,
}: { adminUserId?: string | null; seeded?: boolean } = {}) {
  const milestones = MemoryNurturingMilestonesRepository.create();
  await milestones.recordOrganization({ organizationId: "org-1", adminUserId, seeded });
  const service = NurturingCodingMilestonesService.create({
    milestones,
    projects: MemoryNurturingProjectDirectoryRepository.create({
      placed: new Map([
        ["project-1", "org-1"],
        ["project-2", "org-1"],
      ]),
    }),
  });
  const delivered: NurturingSignal[] = [];
  const send = (sessions: CodingAgentSessionStoredEventData[]) =>
    service.sessionsStored({
      sessions,
      deliver: async (signal) => void delivered.push(signal),
    });
  const ofKind = (kind: NurturingSignal["kind"]) =>
    delivered.filter((signal) => signal.kind === kind);
  return { send, delivered, ofKind };
}

describe("NurturingCodingMilestonesService", () => {
  describe("when the organization's first coding session arrives", () => {
    /** @scenario "The first coding-agent session raises one first-session signal" */
    it("raises one first-session signal naming the admin, the project and the agent", async () => {
      const { send, ofKind } = await serviceOver();

      await send([fact()]);

      expect(ofKind("coding_agent_first_session")).toMatchObject([
        {
          userId: "admin-1",
          projectId: "project-1",
          agentType: "claude_code",
          agentTypes: ["claude_code"],
          occurredAt: DAY,
        },
      ]);
    });

    it("raises no separate agent-types signal for the same event", async () => {
      const { send, ofKind } = await serviceOver();

      await send([fact()]);

      expect(ofKind("coding_agent_types")).toEqual([]);
    });

    it("raises the last-session signal for the project", async () => {
      const { send, ofKind } = await serviceOver();

      await send([fact()]);

      expect(ofKind("coding_session_stored")).toMatchObject([
        { userId: "admin-1", projectId: "project-1", tenantId: "project-1", occurredAt: DAY },
      ]);
    });

    it("sets the active-day count to one", async () => {
      const { send, ofKind } = await serviceOver();

      await send([fact()]);

      expect(ofKind("coding_active_days")).toMatchObject([{ codingActiveDays: 1 }]);
    });
  });

  describe("when the same session fact is delivered again", () => {
    /** @scenario "A redelivered or second first-session fact raises no second signal" */
    it("raises no second first-session signal", async () => {
      const { send, ofKind } = await serviceOver();

      await send([fact()]);
      await send([fact()]);

      expect(ofKind("coding_agent_first_session")).toHaveLength(1);
    });
  });

  describe("when a second project of the organization also reports first", () => {
    it("raises no second first-session signal", async () => {
      const { send, ofKind } = await serviceOver();

      await send([fact()]);
      await send([fact({ tenantId: "project-2", projectId: "project-2", sessionId: "session-9" })]);

      expect(ofKind("coding_agent_first_session")).toHaveLength(1);
    });
  });

  describe("when two first-session facts arrive at once", () => {
    it("raises one first-session signal", async () => {
      const { send, ofKind } = await serviceOver();

      await Promise.all([
        send([fact()]),
        send([fact({ tenantId: "project-2", projectId: "project-2", sessionId: "session-9" })]),
      ]);

      expect(ofKind("coding_agent_first_session")).toHaveLength(1);
    });
  });

  describe("when a later session uses another agent", () => {
    let ofKind: Awaited<ReturnType<typeof serviceOver>>["ofKind"];

    beforeEach(async () => {
      const over = await serviceOver();
      ofKind = over.ofKind;
      await over.send([fact()]);
      await over.send([
        fact({ sessionId: "session-2", agentType: "codex", firstForProject: false }),
      ]);
    });

    /** @scenario "A second agent type extends the list without a first-session signal" */
    it("raises the full sorted list of agent types", () => {
      expect(ofKind("coding_agent_types")).toMatchObject([
        { agentTypes: ["claude_code", "codex"] },
      ]);
    });

    it("raises no second first-session signal", () => {
      expect(ofKind("coding_agent_first_session")).toHaveLength(1);
    });
  });

  describe("when a known agent type reports again", () => {
    it("raises no agent-types signal", async () => {
      const { send, ofKind } = await serviceOver();

      await send([fact({ firstForProject: false })]);
      await send([fact({ sessionId: "session-2", firstForProject: false })]);

      expect(ofKind("coding_agent_types")).toHaveLength(1);
    });
  });

  describe("when the organization is seeded from the backfill", () => {
    /** @scenario "A seeded organization never gets the first-session signal" */
    it("raises no first-session signal", async () => {
      const { send, ofKind } = await serviceOver({ seeded: true });

      await send([fact()]);

      expect(ofKind("coding_agent_first_session")).toEqual([]);
    });

    it("still sets the active-day count to one", async () => {
      const { send, ofKind } = await serviceOver({ seeded: true });

      await send([fact()]);

      expect(ofKind("coding_active_days")).toMatchObject([{ codingActiveDays: 1 }]);
    });
  });

  describe("when the fact says the project's first is false", () => {
    /** @scenario "A session that is not the project's first raises no first-session signal" */
    it("raises no first-session signal", async () => {
      const { send, ofKind } = await serviceOver();

      await send([fact({ firstForProject: false })]);

      expect(ofKind("coding_agent_first_session")).toEqual([]);
    });

    it("sets the active-day count to one", async () => {
      const { send, ofKind } = await serviceOver();

      await send([fact({ firstForProject: false })]);

      expect(ofKind("coding_active_days")).toMatchObject([{ codingActiveDays: 1 }]);
    });
  });

  describe("when sessions arrive on several UTC days", () => {
    /** @scenario "Active days count one per later UTC day" */
    it("counts D, D, D+1 and D+3 as 1, 2 and 3 with one signal per new day", async () => {
      const { send, ofKind } = await serviceOver();

      await send([fact({ firstForProject: false })]);
      await send([fact({ sessionId: "s-2", firstForProject: false, occurredAt: DAY + HOUR })]);
      await send([fact({ sessionId: "s-3", firstForProject: false, occurredAt: DAY + 24 * HOUR })]);
      await send([fact({ sessionId: "s-4", firstForProject: false, occurredAt: DAY + 72 * HOUR })]);

      expect(
        ofKind("coding_active_days").map(
          (s) => (s as { codingActiveDays: number }).codingActiveDays,
        ),
      ).toEqual([1, 2, 3]);
    });

    /** @scenario "A session just before and just after UTC midnight counts as two days" */
    it("counts 23:59 and 00:01 as two days", async () => {
      const { send, ofKind } = await serviceOver();

      await send([fact({ firstForProject: false, occurredAt: Date.UTC(2026, 9, 20, 23, 59) })]);
      await send([
        fact({ sessionId: "s-2", firstForProject: false, occurredAt: Date.UTC(2026, 9, 21, 0, 1) }),
      ]);

      expect(
        ofKind("coding_active_days").map(
          (s) => (s as { codingActiveDays: number }).codingActiveDays,
        ),
      ).toEqual([1, 2]);
    });

    /** @scenario "A late session of an earlier day changes nothing" */
    it("raises no active-day signal for a late session of an earlier day", async () => {
      const { send, ofKind } = await serviceOver();

      await send([fact({ firstForProject: false, occurredAt: DAY + 72 * HOUR })]);
      await send([fact({ sessionId: "s-2", firstForProject: false, occurredAt: DAY + 48 * HOUR })]);

      expect(ofKind("coding_active_days")).toHaveLength(1);
    });
  });

  describe("when the organization has no admin", () => {
    /** @scenario "An organization with no admin raises nothing" */
    it("raises no signal", async () => {
      const { send, delivered } = await serviceOver({ adminUserId: null });

      await send([fact()]);

      expect(delivered).toEqual([]);
    });
  });

  describe("when the project's organization is unknown", () => {
    it("raises no signal", async () => {
      const { send, delivered } = await serviceOver();

      await send([fact({ tenantId: "project-x", projectId: "project-x" })]);

      expect(delivered).toEqual([]);
    });
  });
});
