/**
 * @vitest-environment node
 * @unit
 *
 * The fold-side trigger that records coding-agent activity on the project.
 *
 * @see specs/coding-agent/project-menu-links.feature
 */
import { describe, expect, it, vi } from "vitest";

const logger = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
}));

vi.mock("@langwatch/observability", () => ({
  createLogger: () => logger,
}));

import type { CodingAgentSessionState } from "../../projections/codingAgentSession.foldProjection";
import type { CodingAgentProcessingEvent } from "../../schemas/events";
import {
  CODING_AGENT_SESSION_SEEN_WINDOW_MS,
  codingAgentSessionSeenGroupKey,
  createCodingAgentSessionSeenReactor,
} from "../codingAgentSessionSeen.reactor";

const event = {
  tenantId: "project-1",
  aggregateId: "session-1",
} as unknown as CodingAgentProcessingEvent;

function contextFor(tenantId = "project-1") {
  return {
    tenantId,
    aggregateId: "session-1",
    foldState: {} as CodingAgentSessionState,
  };
}

describe("codingAgentSessionSeen reactor", () => {
  describe("given a session folded for a project", () => {
    it("records the activity against that project", async () => {
      const touchCodingAgentSessionSeen = vi.fn().mockResolvedValue(undefined);
      const reactor = createCodingAgentSessionSeenReactor({
        touchCodingAgentSessionSeen,
      });

      await reactor.handle(event, contextFor());

      expect(touchCodingAgentSessionSeen).toHaveBeenCalledTimes(1);
      expect(touchCodingAgentSessionSeen.mock.calls[0]?.[0]).toMatchObject({
        projectId: "project-1",
      });
      expect(touchCodingAgentSessionSeen.mock.calls[0]?.[0].at).toBeInstanceOf(
        Date,
      );
    });

    // Any fold is evidence, whatever the session carries. A guard here would
    // silently exclude every agent that reports no git context, which is most
    // of them.
    it("records it whatever the session carried", async () => {
      const touchCodingAgentSessionSeen = vi.fn().mockResolvedValue(undefined);
      const reactor = createCodingAgentSessionSeenReactor({
        touchCodingAgentSessionSeen,
      });

      expect(reactor.shouldReact?.(event, contextFor())).not.toBe(false);
      await reactor.handle(event, contextFor());

      expect(touchCodingAgentSessionSeen).toHaveBeenCalledTimes(1);
    });
  });

  describe("when recording the activity fails", () => {
    it("swallows the failure so the committed session is not retried", async () => {
      const touchCodingAgentSessionSeen = vi
        .fn()
        .mockRejectedValue(new Error("postgres is unhappy"));
      const reactor = createCodingAgentSessionSeenReactor({
        touchCodingAgentSessionSeen,
      });

      await expect(
        reactor.handle(event, contextFor()),
      ).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalled();
    });
  });

  describe("given two sessions of the same project fold at once", () => {
    // The queue only squashes a duplicate while the existing job is found in
    // the NEW payload's own group. A per-project dedup id under the pipeline's
    // default per-session grouping never collapses, so both halves have to
    // agree on the project.
    it("puts both in one lane under one job id", () => {
      const reactor = createCodingAgentSessionSeenReactor({
        touchCodingAgentSessionSeen: vi.fn(),
      });
      const first = { event, foldState: {} };
      const second = {
        event: {
          tenantId: "project-1",
          aggregateId: "session-2",
        } as unknown as CodingAgentProcessingEvent,
        foldState: {},
      };

      expect(reactor.options?.groupKeyFn?.(first)).toBe(
        reactor.options?.groupKeyFn?.(second),
      );
      expect(reactor.options?.makeJobId?.(first)).toBe(
        reactor.options?.makeJobId?.(second),
      );
      expect(reactor.options?.groupKeyFn?.(first)).toBe(
        codingAgentSessionSeenGroupKey({ tenantId: "project-1" }),
      );
    });

    it("keeps another project in its own lane", () => {
      const reactor = createCodingAgentSessionSeenReactor({
        touchCodingAgentSessionSeen: vi.fn(),
      });

      expect(reactor.options?.groupKeyFn?.({ event, foldState: {} })).not.toBe(
        reactor.options?.groupKeyFn?.({
          event: {
            tenantId: "project-2",
            aggregateId: "session-9",
          } as unknown as CodingAgentProcessingEvent,
          foldState: {},
        }),
      );
    });
  });

  describe("given a backlog draining past the collapse window", () => {
    // A reactor's ready score is the event's own createdAt, so a backlog
    // stages jobs whose deadline has already passed and the window collapses
    // nothing. The surviving dedup key is what keeps the drain to one write.
    it("keeps the deduplication alive past dispatch", () => {
      const reactor = createCodingAgentSessionSeenReactor({
        touchCodingAgentSessionSeen: vi.fn(),
      });

      expect(reactor.options?.delay).toBe(CODING_AGENT_SESSION_SEEN_WINDOW_MS);
      expect(reactor.options?.deduplication?.shouldSurviveDispatch).toBe(true);
    });
  });
});
