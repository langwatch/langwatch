/**
 * @vitest-environment node
 *
 * The contribution command's one job is to carry the collection-side lift into
 * the event stream unchanged. The event data here is an explicit field map, so
 * a field added to the contribution schema but not to the map is silently
 * dropped before any projection can see it — which is invisible to schema
 * tests and only surfaces as a session fold that never learns its facts.
 */
import { describe, expect, it } from "vitest";
import { createTenantId } from "../../../..";
import type { Command } from "../../../../commands/command";
import type { RecordLogContributionCommandData } from "../../schemas/commands";
import { RECORD_LOG_CONTRIBUTION_COMMAND_TYPE } from "../../schemas/constants";
import { RecordLogContributionCommand } from "../recordLogContributionCommand";

function contribution(
  overrides: Partial<RecordLogContributionCommandData> = {},
): RecordLogContributionCommandData {
  return {
    tenantId: "project_test",
    recordId: "record-1",
    traceId: "0123456789abcdef0123456789abcdef",
    spanId: "0123456789abcdef",
    timeUnixMs: 1_784_500_000_000,
    severityNumber: 0,
    severityText: "",
    providerKind: "claude_code",
    scopeName: "com.anthropic.claude_code.events",
    correlationSource: "claude_synthesized",
    input: null,
    output: null,
    liftedAttributes: {},
    nonBillable: false,
    piiRedactionLevel: "ESSENTIAL",
    occurredAt: 1_784_500_000_000,
    ...overrides,
  };
}

function command(
  data: RecordLogContributionCommandData,
): Command<RecordLogContributionCommandData> {
  return {
    tenantId: createTenantId(data.tenantId),
    aggregateId: data.traceId,
    type: RECORD_LOG_CONTRIBUTION_COMMAND_TYPE,
    data,
  };
}

describe("RecordLogContributionCommand", () => {
  describe("when the contribution carries the coding-agent lift", () => {
    it("keeps codingAgentAttributes and sessionTitle on the event", async () => {
      const handler = new RecordLogContributionCommand();
      const events = await handler.handle(
        command(
          contribution({
            codingAgentAttributes: {
              "event.name": "api_request",
              "session.id": "sess-1",
              "user.id": "user-1",
              input_tokens: 12,
            },
            sessionTitle: "Fix the flaky retry test",
          }),
        ),
      );

      expect(events).toHaveLength(1);
      expect(events[0]!.data.codingAgentAttributes).toEqual({
        "event.name": "api_request",
        "session.id": "sess-1",
        "user.id": "user-1",
        input_tokens: 12,
      });
      expect(events[0]!.data.sessionTitle).toBe("Fix the flaky retry test");
    });
  });

  describe("when the contribution is not a coding agent's", () => {
    it("emits the event without the optional coding-agent fields", async () => {
      const handler = new RecordLogContributionCommand();
      const events = await handler.handle(
        command(contribution({ providerKind: "generic" })),
      );

      expect(events).toHaveLength(1);
      expect(events[0]!.data).not.toHaveProperty("codingAgentAttributes");
      expect(events[0]!.data).not.toHaveProperty("sessionTitle");
    });
  });
});
