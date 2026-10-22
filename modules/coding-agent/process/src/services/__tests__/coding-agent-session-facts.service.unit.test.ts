/**
 * @vitest-environment node
 * @see modules/coding-agent/specs/coding-agent-session-stored.feature
 */
import {
  type CodingAgentSessionStoredEventData,
  MAX_SESSION_ID_LENGTH,
} from "@langwatch/coding-agent-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { projectRow } from "../../__tests__/fixtures/coding-agent.fixture.ts";
import {
  CodingAgentSessionFactsService,
  HOLD_SWEEP_THRESHOLD,
} from "../coding-agent-session-facts.service.ts";
import { CODING_AGENT_SESSION_SEEN_WINDOW_MS } from "../coding-agent-session-seen.service.ts";
import type { StoredSession } from "../coding-agent-session-store.service.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

const stored = (over: Partial<StoredSession> = {}): StoredSession => ({
  tenantId: "project-1",
  sessionId: "session-1",
  agent: "claude_code",
  occurredAt: Date.UTC(2026, 9, 20, 12),
  auxiliary: false,
  ...over,
});

function factsOver({
  lastCodingAgentSessionAt = null,
  hasOtherSession = async () => false,
  record,
  nowMs,
}: {
  lastCodingAgentSessionAt?: Date | null;
  hasOtherSession?: (input: { tenantId: string; excludeSessionId: string }) => Promise<boolean>;
  record?: (fact: CodingAgentSessionStoredEventData) => Promise<void>;
  nowMs?: () => number;
} = {}) {
  const recorded: CodingAgentSessionStoredEventData[] = [];
  const service = CodingAgentSessionFactsService.create({
    projects: createApiFixture<ProjectApi>(
      {
        findById: async (id: string) => projectRow(id, { lastCodingAgentSessionAt }),
      },
      "ProjectApi",
    ),
    sessions: { hasOtherSession },
    recorder: {
      recordSessionStored: record ?? (async (fact) => void recorded.push(fact)),
    },
    ...(nowMs ? { nowMs } : {}),
  });
  return { service, recorded };
}

describe("CodingAgentSessionFactsService", () => {
  describe("given a stored session", () => {
    /** @scenario "A stored session records one session-stored fact" */
    it("records the fact with the product agent, the project and the session's own time", async () => {
      const { service, recorded } = factsOver({ lastCodingAgentSessionAt: new Date(1) });

      await service.record([stored()]);

      expect(recorded).toEqual([
        {
          tenantId: "project-1",
          projectId: "project-1",
          sessionId: "session-1",
          agentType: "claude_code",
          firstForProject: false,
          occurredAt: Date.UTC(2026, 9, 20, 12),
        },
      ]);
    });
  });

  describe("given a batch naming one session twice", () => {
    /** @scenario "A session stored twice in one batch records one fact" */
    it("records one fact for it", async () => {
      const { service, recorded } = factsOver();

      await service.record([stored(), stored({ occurredAt: Date.UTC(2026, 9, 20, 13) })]);

      expect(recorded).toHaveLength(1);
    });
  });

  describe("given a batch of two sessions", () => {
    it("records one fact per session", async () => {
      const { service, recorded } = factsOver();

      await service.record([stored(), stored({ sessionId: "session-2" })]);

      expect(recorded.map((fact) => fact.sessionId).toSorted()).toEqual(["session-1", "session-2"]);
    });
  });

  describe("given an auxiliary helper-thread session", () => {
    /** @scenario "A helper-thread session records no fact" */
    it("records nothing", async () => {
      const { service, recorded } = factsOver();

      await service.record([stored({ auxiliary: true })]);

      expect(recorded).toEqual([]);
    });
  });

  describe("given a session with no named coding agent", () => {
    /** @scenario "A stored session with no named coding agent records no fact" */
    it("records nothing", async () => {
      const { service, recorded } = factsOver();

      await service.record([stored({ agent: null })]);

      expect(recorded).toEqual([]);
    });
  });

  describe("given a session with an over-long id", () => {
    /** @scenario "A stored session with an over-long id records no fact" */
    it("records nothing and does not call the recorder", async () => {
      const record = vi.fn(async () => {});
      const { service, recorded } = factsOver({ record });

      await service.record([stored({ sessionId: "s".repeat(MAX_SESSION_ID_LENGTH + 1) })]);

      expect(recorded).toEqual([]);
      expect(record).not.toHaveBeenCalled();
    });
  });

  describe("when deciding whether the session is the project's first", () => {
    /** @scenario "The first session of a project is flagged" */
    it("flags it when the project is unstamped and holds no other session", async () => {
      const { service, recorded } = factsOver();

      await service.record([stored()]);

      expect(recorded[0]?.firstForProject).toBe(true);
    });

    /** @scenario "A project already stamped is never first" */
    it("does not flag it when the project is already stamped", async () => {
      const { service, recorded } = factsOver({ lastCodingAgentSessionAt: new Date(1) });

      await service.record([stored()]);

      expect(recorded[0]?.firstForProject).toBe(false);
    });

    /** @scenario "A project with an older session is never first" */
    it("does not flag it when another session of the project exists", async () => {
      const { service, recorded } = factsOver({ hasOtherSession: async () => true });

      await service.record([stored()]);

      expect(recorded[0]?.firstForProject).toBe(false);
    });

    it("asks about other sessions without counting the stored one", async () => {
      const asked: { tenantId: string; excludeSessionId: string }[] = [];
      const { service } = factsOver({
        hasOtherSession: async (input) => {
          asked.push(input);
          return false;
        },
      });

      await service.record([stored()]);

      expect(asked).toEqual([{ tenantId: "project-1", excludeSessionId: "session-1" }]);
    });

    /** @scenario "A failing history check fails closed" */
    it("does not flag it when the ClickHouse check throws", async () => {
      const { service, recorded } = factsOver({
        hasOtherSession: async () => {
          throw new Error("clickhouse down");
        },
      });

      await service.record([stored()]);

      expect(recorded[0]?.firstForProject).toBe(false);
    });
  });

  describe("when the recorder fails", () => {
    /** @scenario "A failing session-stored recorder never fails the stored row" */
    it("resolves without throwing", async () => {
      const { service } = factsOver({
        record: async () => {
          throw new Error("event store unavailable");
        },
      });

      await expect(service.record([stored()])).resolves.toBeUndefined();
    });
  });

  describe("given a session time more than a day ahead", () => {
    /** @scenario "A session time more than a day ahead is recorded as one day ahead" */
    it("records it one day after now", async () => {
      const now = Date.UTC(2026, 9, 20, 12);
      const { service, recorded } = factsOver({ nowMs: () => now });

      await service.record([stored({ occurredAt: now + 365 * DAY_MS })]);

      expect(recorded[0]?.occurredAt).toBe(now + DAY_MS);
    });
  });

  describe("given a session reported again", () => {
    /** @scenario "A session reported again inside the hold records no second fact" */
    it("records no second fact inside the hold", async () => {
      let now = Date.UTC(2026, 9, 20, 12);
      const { service, recorded } = factsOver({ nowMs: () => now });

      await service.record([stored()]);
      now += CODING_AGENT_SESSION_SEEN_WINDOW_MS - 1;
      await service.record([stored()]);

      expect(recorded).toHaveLength(1);
    });

    /** @scenario "A session reported again after the hold records again" */
    it("records again after the hold", async () => {
      let now = Date.UTC(2026, 9, 20, 12);
      const { service, recorded } = factsOver({ nowMs: () => now });

      await service.record([stored()]);
      now += CODING_AGENT_SESSION_SEEN_WINDOW_MS;
      await service.record([stored()]);

      expect(recorded).toHaveLength(2);
    });

    /** @scenario "A session reported on two UTC days records on both" */
    it("records at 23:59 UTC and again at 00:01 UTC", async () => {
      let now = Date.UTC(2026, 9, 20, 23, 59);
      const { service, recorded } = factsOver({ nowMs: () => now });

      await service.record([stored({ occurredAt: now })]);
      now += 2 * 60 * 1000;
      await service.record([stored({ occurredAt: now })]);

      expect(recorded).toHaveLength(2);
    });
  });

  describe("when the recorder fails once", () => {
    /** @scenario "A failed recording releases the hold" */
    it("retries the same session on the next report", async () => {
      const now = Date.UTC(2026, 9, 20, 12);
      let failing = true;
      const attempts: CodingAgentSessionStoredEventData[] = [];
      const { service } = factsOver({
        nowMs: () => now,
        record: async (fact) => {
          attempts.push(fact);
          if (failing) throw new Error("event store unavailable");
        },
      });

      await service.record([stored()]);
      failing = false;
      await service.record([stored()]);

      expect(attempts).toHaveLength(2);
    });
  });

  describe("when the hold map is full", () => {
    /** @scenario "Expired holds are swept when the hold map is full" */
    it("still records a session whose hold expired", async () => {
      let now = Date.UTC(2026, 9, 20, 12);
      const { service, recorded } = factsOver({ nowMs: () => now });
      await service.record(
        Array.from({ length: HOLD_SWEEP_THRESHOLD }, (_, index) =>
          stored({ sessionId: `session-${index}` }),
        ),
      );
      recorded.length = 0;

      now += CODING_AGENT_SESSION_SEEN_WINDOW_MS;
      await service.record([stored({ sessionId: "session-0" })]);

      expect(recorded.map((fact) => fact.sessionId)).toEqual(["session-0"]);
    });
  });
});
