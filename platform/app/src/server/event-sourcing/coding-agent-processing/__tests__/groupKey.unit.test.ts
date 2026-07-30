import { parseGroupKey, renderGroupKey } from "@langwatch/event-sourcing";
import { describe, expect, it } from "vitest";
import {
  codingAgentContributionCommandGroupKey,
  codingAgentSessionContributionsGroupKey,
  codingAgentSessionGroupKey,
  codingAgentTraceSessionsGroupKey,
  renderCodingAgentSessionGroupKey,
} from "../groupKey";

const TENANT = "tenant-1";
const SESSION = "session-1";

describe("given this pipeline's group keys", () => {
  describe("when built for the identity fold", () => {
    it("is scoped to the aggregate, never a wider scope", () => {
      const key = codingAgentSessionGroupKey({
        tenantId: TENANT,
        sessionId: SESSION,
      });
      expect(key.lane).toEqual({ kind: "fold", name: "codingAgentSession" });
      expect(key.scope).toEqual({
        kind: "aggregate",
        aggregateType: "coding_agent_session",
        aggregateId: SESSION,
      });
    });

    it("round-trips through the package's own renderer and parser", () => {
      const key = codingAgentSessionGroupKey({
        tenantId: TENANT,
        sessionId: SESSION,
      });
      const rendered = renderGroupKey(key);
      expect(parseGroupKey(rendered)).toEqual(key);
      expect(
        renderCodingAgentSessionGroupKey({
          tenantId: TENANT,
          sessionId: SESSION,
        }),
      ).toBe(rendered);
    });
  });

  describe("when a session id contains the renderer's separator", () => {
    it("still round-trips — nothing here concatenates strings by hand", () => {
      const weirdSessionId = "a/b/c";
      const key = codingAgentSessionGroupKey({
        tenantId: TENANT,
        sessionId: weirdSessionId,
      });
      const rendered = renderGroupKey(key);
      expect(parseGroupKey(rendered).scope).toEqual({
        kind: "aggregate",
        aggregateType: "coding_agent_session",
        aggregateId: weirdSessionId,
      });
    });
  });

  describe("when built for the two map projections", () => {
    it("both are scoped to the session, so a session's contributions coalesce into one lane per projection", () => {
      const traceSessions = codingAgentTraceSessionsGroupKey({
        tenantId: TENANT,
        sessionId: SESSION,
      });
      const contributions = codingAgentSessionContributionsGroupKey({
        tenantId: TENANT,
        sessionId: SESSION,
      });

      expect(traceSessions.lane).toEqual({
        kind: "map",
        name: "codingAgentTraceSessions",
      });
      expect(contributions.lane).toEqual({
        kind: "map",
        name: "codingAgentSessionContributions",
      });
      expect(traceSessions.scope.kind).toBe("aggregate");
      expect(contributions.scope.kind).toBe("aggregate");
    });
  });

  describe("when built for the three contribution commands", () => {
    it("each command gets its own lane, all scoped to the same session", () => {
      const span = codingAgentContributionCommandGroupKey({
        tenantId: TENANT,
        sessionId: SESSION,
        command: "contributeSpanFacts",
      });
      const log = codingAgentContributionCommandGroupKey({
        tenantId: TENANT,
        sessionId: SESSION,
        command: "contributeLogFacts",
      });

      expect(span.lane).toEqual({
        kind: "command",
        name: "contributeSpanFacts",
      });
      expect(log.lane).toEqual({ kind: "command", name: "contributeLogFacts" });
      expect(span.scope).toEqual(log.scope);
    });
  });
});
