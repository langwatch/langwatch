/** Spec: enterprise/modules/governance/specs/ocsf-siem.feature */
import type { GovernanceOcsfExportRow } from "@langwatch/enterprise-governance-contract";
import { describe, expect, it } from "vitest";

import { auditEntryToOcsfEvent } from "../ocsf-v1-9-audit.rules.ts";
import {
  governanceRowToOcsfEvent,
  projectTraceToOcsfEvent,
  type ProjectTraceSummary,
} from "../ocsf-v1-9-event.rules.ts";

const ORG = "org-1";
const TIME = Date.parse("2026-11-10T12:00:00Z");

function row(overrides: Partial<GovernanceOcsfExportRow> = {}): GovernanceOcsfExportRow {
  return {
    eventId: "trace-1",
    ocsfSchemaVersion: "1.1.0",
    traceId: "trace-1",
    sourceId: "src-1",
    sourceType: "otel_generic",
    classUid: 6003,
    categoryUid: 6,
    activityId: 6,
    typeUid: 600306,
    severityId: 1,
    eventTimeMs: TIME,
    actorUserId: "user-1",
    actorEmail: "jane@acme.test",
    actorEnduserId: "",
    actionName: "trace.recorded",
    targetName: "openai/gpt-5-mini",
    anomalyAlertId: "",
    rawOcsfJson: JSON.stringify({
      metadata: {
        extension: {
          model: "openai/gpt-5-mini",
          tokens_input: 120,
          tokens_output: 30,
          cost_usd: 0.0042,
        },
      },
    }),
    ...overrides,
  };
}

function deepKeys(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) => [key, ...deepKeys(child)]);
}

describe("governanceRowToOcsfEvent()", () => {
  describe("given a governance trace with model, tokens and cost", () => {
    /** @scenario A governance trace becomes an OCSF 1.9 event with its AI model, tokens and cost */
    it("fills ai_model, message_context and the cost", () => {
      const event = governanceRowToOcsfEvent({ row: row(), organizationId: ORG });

      expect(event.class_uid).toBe(6003);
      expect(event.metadata).toMatchObject({ version: "1.9.0", uid: "trace-1", tenant_uid: ORG });
      expect(event.ai_model).toEqual({ name: "gpt-5-mini", ai_provider: "openai" });
      expect(event.message_context).toEqual({
        uid: "trace-1",
        prompt_tokens: 120,
        completion_tokens: 30,
        total_tokens: 150,
      });
      expect(event.unmapped).toMatchObject({ langwatch: { cost_usd: 0.0042 } });
      expect(event.time).toBe(TIME);
    });
  });

  describe("given a row stored with the OCSF 1.1 invoke activity", () => {
    /** @scenario An LLM invocation is exported as activity Other named Invoke */
    it("emits activity 99 named Invoke", () => {
      const event = governanceRowToOcsfEvent({ row: row(), organizationId: ORG });

      expect(event.activity_id).toBe(99);
      expect(event.activity_name).toBe("Invoke");
      expect(event.type_uid).toBe(600399);
    });
  });

  describe("given a stored payload holding prompt and response text", () => {
    /** @scenario Prompt and response text never leave in an exported event */
    it("exports neither text", () => {
      const event = governanceRowToOcsfEvent({
        row: row({
          rawOcsfJson: JSON.stringify({
            metadata: {
              extension: {
                prompt_text: "secret question",
                response_text: "secret answer",
                raw_event: { prompt: "secret question" },
              },
            },
          }),
        }),
        organizationId: ORG,
      });

      const json = JSON.stringify(event);
      expect(deepKeys(event)).not.toContain("prompt_text");
      expect(deepKeys(event)).not.toContain("response_text");
      expect(json).not.toContain("secret");
    });
  });

  describe("given a pulled provider event", () => {
    /** @scenario A pulled provider event carries its model and tokens into the AI fields */
    it("names the target model and counts its tokens", () => {
      const event = governanceRowToOcsfEvent({
        row: row({
          eventId: "claude_compliance:src-2:evt-1",
          traceId: "pull:claude_compliance:src-2:evt-1",
          sourceType: "claude_compliance",
          actionName: "message.create",
          targetName: "claude-sonnet-4",
          rawOcsfJson: JSON.stringify({
            metadata: { extension: { tokens_input: 900, tokens_output: 200, cost_usd: 0.01 } },
          }),
        }),
        organizationId: ORG,
      });

      expect(event.ai_model).toEqual({ name: "claude-sonnet-4", ai_provider: "Unknown" });
      expect(event.message_context).toMatchObject({ total_tokens: 1100 });
    });
  });

  describe("given an admin workspace view", () => {
    /** @scenario An admin workspace view is exported as a Read of the workspace it opened */
    it("is a Read naming the workspace, with no model", () => {
      const event = governanceRowToOcsfEvent({
        row: row({
          eventId: "audit-1",
          traceId: "",
          sourceId: "team-1",
          sourceType: "team",
          activityId: 2,
          actionName: "governance.viewWorkspaceAs",
          targetName: "Payments team",
          rawOcsfJson: JSON.stringify({ action: "governance.viewWorkspaceAs" }),
        }),
        organizationId: ORG,
      });

      expect(event.activity_id).toBe(2);
      expect(event.resources).toEqual([{ uid: "team-1", name: "Payments team", type: "team" }]);
      expect(event.ai_model).toBeUndefined();
    });
  });

  describe("given an event pushed in from another source", () => {
    /** @scenario An event pushed in from another source is exported as it was received */
    it("returns the received event unchanged", () => {
      const received = {
        class_uid: 3002,
        activity_id: 1,
        severity_id: 1,
        time: TIME,
        metadata: { uid: "okta-1", version: "1.4.0", product: { name: "Okta" } },
        user: { name: "jane" },
      };
      const event = governanceRowToOcsfEvent({
        row: row({ sourceType: "ocsf_push", rawOcsfJson: JSON.stringify(received) }),
        organizationId: ORG,
      });

      expect(event).toEqual(received);
    });
  });
});

describe("projectTraceToOcsfEvent()", () => {
  describe("given a project trace by an agent", () => {
    /** @scenario A project trace becomes an OCSF event naming its project, model and agent */
    it("names the model, agent, user and project", () => {
      const summary: ProjectTraceSummary = {
        traceId: "t-9",
        occurredAt: TIME,
        totalCost: 0.02,
        totalPromptTokenCount: 10,
        totalCompletionTokenCount: 5,
        models: ["anthropic/claude-sonnet-4"],
        attributes: { "gen_ai.agent.name": "billing-agent", "user.id": "user-7" },
        containsErrorStatus: false,
        traceName: "answer",
      };
      const event = projectTraceToOcsfEvent({
        summary,
        projectId: "project-1",
        organizationId: ORG,
      });

      expect(event.ai_model).toEqual({ name: "claude-sonnet-4", ai_provider: "anthropic" });
      expect(event.ai_agent).toEqual({ name: "billing-agent" });
      expect(event.actor).toEqual({ user: { uid: "user-7" } });
      expect(event.unmapped).toMatchObject({
        langwatch: { project_id: "project-1", trace_id: "t-9", cost_usd: 0.02 },
      });
      expect(event.metadata).toMatchObject({ uid: "trace:project-1:t-9", log_name: "traces" });
      expect(event.status_id).toBe(1);
    });
  });
});

describe("auditEntryToOcsfEvent()", () => {
  describe("given a failed member removal", () => {
    /** @scenario An audit log entry becomes an OCSF event with its actor, target and outcome */
    it("is a failed Delete by the actor on the member", () => {
      const event = auditEntryToOcsfEvent({
        entry: {
          id: "a-1",
          createdAt: new Date(TIME),
          userId: "user-1",
          actorUserId: null,
          organizationId: ORG,
          projectId: null,
          action: "organization.member.remove",
          error: "Member not found",
          ipAddress: "203.0.113.7",
          userAgent: "curl/8",
          targetKind: "member",
          targetId: "user-9",
        },
        organizationId: ORG,
      });

      expect(event.activity_id).toBe(4);
      expect(event.status_id).toBe(2);
      expect(event.actor).toEqual({ user: { uid: "user-1" } });
      expect(event.resources).toEqual([{ uid: "user-9", type: "member" }]);
      expect(event.src_endpoint).toEqual({ ip: "203.0.113.7" });
    });
  });
});
