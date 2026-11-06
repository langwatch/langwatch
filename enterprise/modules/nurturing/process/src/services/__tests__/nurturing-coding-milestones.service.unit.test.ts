// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * @vitest-environment node
 * @see enterprise/modules/nurturing/specs/coding-agent-signals.feature
 */
import type { CodingAgentSessionStoredEventData } from "@langwatch/coding-agent-contract";
import type { NurturingSignal, NurturingSignalOf } from "@langwatch/enterprise-nurturing-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { nurturingSignalKey } from "../../eventing/nurturing-signal.commands.ts";
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
  failFirstDeliveryOf,
  organizationCreatedAt,
  now = DAY,
  personalOwners = new Map<string, string>(),
}: {
  adminUserId?: string | null;
  seeded?: boolean;
  failFirstDeliveryOf?: NurturingSignal["kind"];
  organizationCreatedAt?: number;
  now?: number;
  personalOwners?: ReadonlyMap<string, string>;
} = {}) {
  const milestones = MemoryNurturingMilestonesRepository.create();
  await milestones.recordOrganization({ organizationId: "org-1", adminUserId, seeded });
  const projects = MemoryNurturingProjectDirectoryRepository.create({
    placed: new Map([
      ["project-1", "org-1"],
      ["project-2", "org-1"],
    ]),
    organizationsCreated: new Map(
      organizationCreatedAt === undefined ? [] : [["org-1", organizationCreatedAt]],
    ),
    personalOwners,
  });
  const firstProjectRead = vi.spyOn(projects, "getFirstProjectCreatedAt");
  const creationRead = vi.spyOn(projects, "getOrganizationCreatedAt");
  const service = NurturingCodingMilestonesService.create({
    milestones,
    projects,
    organizations: createApiFixture<OrganizationApi>({
      getAllMembers: async () => [{ id: "admin-1" }, { id: "member-2" }] as never,
    }),
    clock: { nowMs: () => now },
  });
  const delivered: NurturingSignal[] = [];
  const claimed = new Set<string>();
  let failed = false;
  // Delivery's own claim: a signal already sent is not sent again.
  const deliver = async (signal: NurturingSignal) => {
    if (signal.kind === failFirstDeliveryOf && !failed) {
      failed = true;
      throw new Error("delivery failed");
    }
    const key = nurturingSignalKey(signal);
    if (claimed.has(key)) return;
    claimed.add(key);
    delivered.push(signal);
  };
  const send = (sessions: CodingAgentSessionStoredEventData[]) =>
    service.sessionsStored({ sessions, deliver });
  const ofKind = <Kind extends NurturingSignal["kind"]>(kind: Kind) =>
    delivered.filter((signal): signal is NurturingSignalOf<Kind> => signal.kind === kind);
  return { send, delivered, ofKind, firstProjectRead, creationRead };
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

  describe("when the first batch holds sessions of two agents", () => {
    /** @scenario "The first session names every agent type of its batch" */
    it("names both agent types on the first-session signal", async () => {
      const { send, ofKind } = await serviceOver();

      await send([fact(), fact({ sessionId: "session-2", agentType: "codex" })]);

      expect(ofKind("coding_agent_first_session")).toMatchObject([
        { agentTypes: ["claude_code", "codex"] },
      ]);
    });
  });

  describe("when the first session is raised", () => {
    /** @scenario "The first session carries every active member of the organization" */
    it("carries the organization's members for uses_coding_agent", async () => {
      const { send, ofKind } = await serviceOver();

      await send([fact()]);

      expect(ofKind("coding_agent_first_session")).toMatchObject([
        { memberUserIds: ["admin-1", "member-2"] },
      ]);
    });
  });

  describe("when delivering the first-session signal fails once", () => {
    /** @scenario "A delivery that fails before it is claimed is not lost when the fact is redelivered" */
    it("sends the first-session signal exactly once after the redelivery", async () => {
      const { send, ofKind } = await serviceOver({
        failFirstDeliveryOf: "coding_agent_first_session",
      });

      await expect(send([fact()])).rejects.toThrow("delivery failed");
      await send([fact()]);
      await send([fact()]);

      expect(ofKind("coding_agent_first_session")).toHaveLength(1);
    });
  });

  describe("when delivering the active-day signal fails once", () => {
    /** @scenario "A delivery that fails before it is claimed is not lost when the fact is redelivered" */
    it("sends the active-day signal exactly once after the redelivery", async () => {
      const { send, ofKind } = await serviceOver({ failFirstDeliveryOf: "coding_active_days" });

      await expect(send([fact()])).rejects.toThrow("delivery failed");
      await send([fact()]);

      expect(ofKind("coding_active_days")).toMatchObject([{ codingActiveDays: 1 }]);
    });
  });

  describe("when no fact says first for its project", () => {
    /** @scenario "The owners' first project is read only for a first session" */
    it("never reads the organization's first project", async () => {
      const { send, firstProjectRead } = await serviceOver();

      await send([fact({ firstForProject: false })]);

      expect(firstProjectRead).not.toHaveBeenCalled();
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

      expect(ofKind("coding_active_days").map((s) => s.codingActiveDays)).toEqual([1, 2, 3]);
    });

    /** @scenario "A session just before and just after UTC midnight counts as two days" */
    it("counts 23:59 and 00:01 as two days", async () => {
      const { send, ofKind } = await serviceOver();

      await send([fact({ firstForProject: false, occurredAt: Date.UTC(2026, 9, 20, 23, 59) })]);
      await send([
        fact({ sessionId: "s-2", firstForProject: false, occurredAt: Date.UTC(2026, 9, 21, 0, 1) }),
      ]);

      expect(ofKind("coding_active_days").map((s) => s.codingActiveDays)).toEqual([1, 2]);
    });

    /** @scenario "One batch over midnight counts both of its days" */
    it("counts both days of a batch that spans midnight", async () => {
      const { send, ofKind } = await serviceOver();

      await send([fact({ firstForProject: false, occurredAt: Date.UTC(2026, 9, 19, 12) })]);
      await send([
        fact({
          sessionId: "s-2",
          firstForProject: false,
          occurredAt: Date.UTC(2026, 9, 20, 23, 59),
        }),
        fact({ sessionId: "s-3", firstForProject: false, occurredAt: Date.UTC(2026, 9, 21, 0, 1) }),
      ]);

      expect(ofKind("coding_active_days").map((s) => s.codingActiveDays)).toEqual([1, 3]);
    });

    /** @scenario "A late session of an earlier day changes nothing" */
    it("raises no active-day signal for a late session of an earlier day", async () => {
      const { send, ofKind } = await serviceOver();

      await send([fact({ firstForProject: false, occurredAt: DAY + 72 * HOUR })]);
      await send([fact({ sessionId: "s-2", firstForProject: false, occurredAt: DAY + 48 * HOUR })]);

      expect(ofKind("coding_active_days")).toHaveLength(1);
    });
  });

  describe("when sessions name terminal types", () => {
    const terminalTypesOf = (ofKind: Awaited<ReturnType<typeof serviceOver>>["ofKind"]) =>
      ofKind("coding_terminal_types").map((signal) => signal.terminalTypes);

    /** @scenario "A new terminal type raises the full sorted list of terminal types" */
    it("raises the full sorted list each time a new one appears", async () => {
      const { send, ofKind } = await serviceOver();

      await send([fact({ terminalType: "vscode" })]);
      await send([fact({ sessionId: "s-2", terminalType: "ghostty" })]);

      expect(terminalTypesOf(ofKind)).toEqual([["vscode"], ["ghostty", "vscode"]]);
    });

    it("raises one signal naming both for a batch of two", async () => {
      const { send, ofKind } = await serviceOver();

      await send([
        fact({ terminalType: "vscode" }),
        fact({ sessionId: "s-2", terminalType: "ghostty" }),
      ]);

      expect(terminalTypesOf(ofKind)).toEqual([["ghostty", "vscode"]]);
    });

    /** @scenario "A known terminal type raises no second terminal-types signal" */
    it("raises no second signal for a known one", async () => {
      const { send, ofKind } = await serviceOver();

      await send([fact({ terminalType: "vscode" })]);
      await send([fact({ sessionId: "s-2", terminalType: "vscode" })]);

      expect(terminalTypesOf(ofKind)).toEqual([["vscode"]]);
    });
  });

  describe("when sessions name repos", () => {
    const countsOf = (ofKind: Awaited<ReturnType<typeof serviceOver>>["ofKind"]) =>
      ofKind("coding_repo_count").map((signal) => signal.codingRepoCount);

    /** @scenario "A new repo grows the organization's repo count" */
    it("counts the repos of every project of the organization", async () => {
      const { send, ofKind } = await serviceOver();

      await send([fact({ repositoryKey: "repo-a" })]);
      await send([
        fact({
          tenantId: "project-2",
          projectId: "project-2",
          sessionId: "s-2",
          repositoryKey: "repo-b",
        }),
      ]);

      expect(countsOf(ofKind)).toEqual([1, 2]);
    });

    it("raises one signal with the count for a batch of two", async () => {
      const { send, ofKind } = await serviceOver();

      await send([
        fact({ repositoryKey: "repo-a" }),
        fact({ sessionId: "s-2", repositoryKey: "repo-b" }),
      ]);

      expect(countsOf(ofKind)).toEqual([2]);
    });

    /** @scenario "A repo seen again does not grow the repo count" */
    it("raises no second signal for a repo seen in another project", async () => {
      const { send, ofKind } = await serviceOver();

      await send([fact({ repositoryKey: "repo-a" })]);
      await send([
        fact({
          tenantId: "project-2",
          projectId: "project-2",
          sessionId: "s-2",
          repositoryKey: "repo-a",
        }),
      ]);

      expect(countsOf(ofKind)).toEqual([1]);
    });

    /** @scenario "A delivery of the new facts that fails is not lost when the fact is redelivered" */
    it("sends the count once when its delivery fails and the fact is redelivered", async () => {
      const { send, ofKind } = await serviceOver({ failFirstDeliveryOf: "coding_repo_count" });

      await expect(send([fact({ repositoryKey: "repo-a" })])).rejects.toThrow("delivery failed");
      await send([fact({ repositoryKey: "repo-a" })]);

      expect(countsOf(ofKind)).toEqual([1]);
    });

    /** @scenario "The repo key never reaches a signal" */
    it("holds the repo key in no signal", async () => {
      const { send, delivered } = await serviceOver();

      await send([fact({ repositoryKey: "repo-key-secret", terminalType: "vscode" })]);

      expect(delivered.map((signal) => signal.kind)).toContain("coding_repo_count");
      expect(JSON.stringify(delivered)).not.toContain("repo-key-secret");
    });
  });

  describe("when a session names no terminal type and no repo", () => {
    /** @scenario "A session with no terminal type or no repo changes neither value" */
    it("raises neither signal for an organization with only such sessions", async () => {
      const { send, ofKind } = await serviceOver();

      await send([fact()]);

      expect([ofKind("coding_terminal_types"), ofKind("coding_repo_count")]).toEqual([[], []]);
    });

    it("raises no further signal after one that named them", async () => {
      const { send, ofKind } = await serviceOver();

      await send([fact({ terminalType: "vscode", repositoryKey: "repo-a" })]);
      await send([fact({ sessionId: "s-2" })]);

      expect([ofKind("coding_terminal_types"), ofKind("coding_repo_count")]).toMatchObject([
        [{ terminalTypes: ["vscode"] }],
        [{ codingRepoCount: 1 }],
      ]);
    });
  });

  describe("when a session names a terminal type and a repo", () => {
    /** @scenario "The terminal types and repo count go to whoever gets the agent types" */
    it("raises both for the person the agent-types signal names", async () => {
      const { send, ofKind } = await serviceOver();

      await send([fact({ firstForProject: false, terminalType: "vscode", repositoryKey: "r" })]);

      const [person] = ofKind("coding_agent_types").map((signal) => signal.userId);
      expect(person).toBeDefined();
      expect(
        [...ofKind("coding_terminal_types"), ...ofKind("coding_repo_count")].map(
          (signal) => signal.userId,
        ),
      ).toEqual([person, person]);
    });
  });

  describe("given an organization created 23:00 UTC on day 0", () => {
    const CREATED = Date.UTC(2026, 9, 20, 23);
    /** Noon UTC on the day offset from the organization's creation. */
    const onDay = (offset: number) => Date.UTC(2026, 9, 20 + offset, 12);
    const session = (sessionId: string, occurredAt: number) =>
      fact({ sessionId, firstForProject: false, occurredAt });
    const countsOf = (ofKind: Awaited<ReturnType<typeof serviceOver>>["ofKind"]) =>
      ofKind("coding_session_days_first_3").map((signal) => signal.codingSessionDaysFirst3);
    const onDay2 = { organizationCreatedAt: CREATED, now: onDay(2) };

    /** @scenario "Sessions on days 0, 1 and 2 count as one, two and three" */
    it("counts sessions on days 0, 1 and 2 as one, two and three", async () => {
      const { send, ofKind } = await serviceOver(onDay2);

      await send([session("s-0", CREATED + 1_000)]);
      await send([session("s-1", onDay(1))]);
      await send([session("s-2", onDay(2))]);

      expect(countsOf(ofKind)).toEqual([1, 2, 3]);
    });

    it("raises one signal with the count for a batch over two days", async () => {
      const { send, ofKind } = await serviceOver(onDay2);

      await send([session("s-1", onDay(1)), session("s-2", onDay(2))]);

      expect(countsOf(ofKind)).toEqual([2]);
    });

    /** @scenario "Two sessions on one day count once" */
    it("counts two sessions on one day once", async () => {
      const { send, ofKind } = await serviceOver(onDay2);

      await send([session("s-1", onDay(1))]);
      await send([session("s-2", onDay(1) + 1_000)]);

      expect(countsOf(ofKind)).toEqual([1]);
    });

    /** @scenario "Days are UTC calendar days from the organization's creation" */
    it("counts 23:30 on day 0 and 00:30 on day 1 as two days", async () => {
      const { send, ofKind } = await serviceOver(onDay2);

      await send([session("s-0", CREATED + 30 * 60 * 1000)]);
      await send([session("s-1", CREATED + 90 * 60 * 1000)]);

      expect(countsOf(ofKind)).toEqual([1, 2]);
    });

    /** @scenario "A session of an earlier day arriving after a later day still counts" */
    it("counts an earlier day arriving after a later one", async () => {
      const { send, ofKind } = await serviceOver(onDay2);

      await send([session("s-2", onDay(2))]);
      await send([session("s-0", CREATED + 1_000)]);

      expect(countsOf(ofKind)).toEqual([1, 2]);
    });

    /** @scenario "A session after day 2 does not grow the first-three-days count" */
    it("does not count a session on day 3", async () => {
      const { send, ofKind } = await serviceOver(onDay2);

      await send([session("s-0", CREATED + 1_000)]);
      await send([session("s-3", onDay(3))]);

      expect(countsOf(ofKind)).toEqual([1]);
    });

    /** @scenario "A session of day 2 handled after day 2 raises nothing" */
    it("raises nothing for a session of day 2 handled on day 3", async () => {
      const { send, ofKind } = await serviceOver({
        organizationCreatedAt: CREATED,
        now: onDay(3),
      });

      await send([session("s-2", onDay(2))]);

      expect(countsOf(ofKind)).toEqual([]);
    });

    /** @scenario "An organization whose first session comes after day 2 never gets the first-three-days count" */
    it("raises nothing for a first session on day 5, and still counts the active day", async () => {
      const { send, ofKind } = await serviceOver({
        organizationCreatedAt: CREATED,
        now: onDay(5),
      });

      await send([session("s-5", onDay(5))]);

      expect(countsOf(ofKind)).toEqual([]);
      expect(ofKind("coding_active_days")).toMatchObject([{ codingActiveDays: 1 }]);
    });

    /** @scenario "A session dated before the organization's creation does not count" */
    it("does not count a session dated the day before", async () => {
      const { send, ofKind } = await serviceOver(onDay2);

      await send([session("s-early", onDay(-1))]);

      expect(countsOf(ofKind)).toEqual([]);
    });

    /** @scenario "A first-three-days delivery that fails is not lost when the fact is redelivered" */
    it("sends the count once when its delivery fails and the fact is redelivered", async () => {
      const { send, ofKind } = await serviceOver({
        ...onDay2,
        failFirstDeliveryOf: "coding_session_days_first_3",
      });

      await expect(send([session("s-1", onDay(1))])).rejects.toThrow("delivery failed");
      await send([session("s-1", onDay(1))]);

      expect(countsOf(ofKind)).toEqual([1]);
    });

    /** @scenario "An organization's creation is read once while the service holds it" */
    it("reads the creation once across batches, and still drops what is past day 2", async () => {
      const { send, ofKind, creationRead } = await serviceOver(onDay2);

      await send([session("s-1", onDay(1))]);
      await send([session("s-2", onDay(2))]);
      await send([session("s-3", onDay(3))]);

      expect(creationRead).toHaveBeenCalledTimes(1);
      expect(countsOf(ofKind)).toEqual([1, 2]);
    });

    /** @scenario "The first-three-days count goes to whoever gets the agent types" */
    it("names the person the agent-types signal names", async () => {
      const { send, ofKind } = await serviceOver(onDay2);

      await send([session("s-1", onDay(1))]);

      const [person] = ofKind("coding_agent_types").map((signal) => signal.userId);
      expect(person).toBeDefined();
      expect(ofKind("coding_session_days_first_3")).toMatchObject([{ userId: person }]);
    });
  });

  describe("when the owners hold no creation time for the organization", () => {
    /** @scenario "An organization whose creation is unknown gets no first-three-days count" */
    it("raises no first-three-days signal", async () => {
      const { send, ofKind } = await serviceOver();

      await send([fact()]);

      expect(ofKind("coding_session_days_first_3")).toEqual([]);
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
  describe("when a personal project stores a session", () => {
    /** @scenario "A personal project's session tells only its owner own_coding_last_session_at" */
    it("raises the own-session signal for its owner alone of two members", async () => {
      const { send, ofKind } = await serviceOver({
        personalOwners: new Map([["project-1", "member-2"]]),
      });

      await send([
        fact({ firstForProject: false, occurredAt: DAY + HOUR }),
        fact({ sessionId: "session-0", firstForProject: false }),
      ]);

      expect(ofKind("own_coding_session_stored")).toMatchObject([
        {
          userId: "member-2",
          projectId: "project-1",
          occurredAt: DAY + HOUR,
          firstOccurredAt: DAY,
        },
      ]);
    });

    /** @scenario "A session in another member's personal project sets only that member's own traits" */
    it("names that project's owner, not the owner of another personal project", async () => {
      const { send, ofKind } = await serviceOver({
        personalOwners: new Map([
          ["project-1", "admin-1"],
          ["project-2", "member-2"],
        ]),
      });

      await send([fact({ tenantId: "project-2", projectId: "project-2" })]);

      expect(ofKind("own_coding_session_stored").map((signal) => signal.userId)).toEqual([
        "member-2",
      ]);
    });

    /** @scenario "A deactivated owner gets no own coding trait" */
    it("raises nothing for an owner who is not an active member", async () => {
      const { send, ofKind } = await serviceOver({
        personalOwners: new Map([["project-1", "gone-3"]]),
      });

      await send([fact()]);

      expect(ofKind("own_coding_session_stored")).toEqual([]);
    });
  });

  describe("when a shared project stores a session", () => {
    /** @scenario "A shared project's session sets no own coding trait" */
    it("raises no own-session signal", async () => {
      const { send, ofKind } = await serviceOver();

      await send([fact()]);

      expect(ofKind("own_coding_session_stored")).toEqual([]);
    });
  });
});
