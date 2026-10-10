/** @see modules/coding-agent/specs/coding-agent-processing-composition.feature */
import { contributeSpanFactsCommandDataSchema } from "@langwatch/coding-agent-contract";
import { describe, expect, it } from "vitest";

import { CodingAgentCommandDispatcherService } from "../coding-agent-command-dispatcher.service.ts";

const facts = contributeSpanFactsCommandDataSchema.parse({
  tenantId: "tenant-1",
  sessionId: "8f2c9a1e-session",
  sessionKeySource: "provider",
  agent: "claude_code",
  occurredAt: 1_760_000_000_000,
  traceId: "trace-1",
  spanId: "span-1",
  name: "claude_code.tool",
  startTimeUnixMs: 1_760_000_000_000,
  endTimeUnixMs: 1_760_000_000_500,
  statusCode: 2,
  facts: { tool_name: "Bash", duration_ms: 500 },
  scopeName: "com.anthropic.claude_code",
});

describe("CodingAgentCommandDispatcherService.contributeSpanFacts", () => {
  describe("given coding_agent_processing registered its senders", () => {
    describe("when trace hands over one span's facts", () => {
      /** @scenario "A span's facts from trace are sent onto the session pipeline" */
      it("sends the facts on contributeSpanFacts", async () => {
        const sent: unknown[] = [];
        const dispatcher = CodingAgentCommandDispatcherService.create();
        dispatcher.connect({
          contributeSpanFacts: {
            send: async (data: unknown) => {
              sent.push(data);
            },
          },
        });

        await dispatcher.contributeSpanFacts(facts);

        expect(sent).toEqual([facts]);
      });
    });
  });

  describe("given no session pipeline registered", () => {
    describe("when trace hands over one span's facts", () => {
      /** @scenario "Span facts sent where no session pipeline registered are refused by name" */
      it("refuses naming the sender", async () => {
        const dispatcher = CodingAgentCommandDispatcherService.create();

        await expect(dispatcher.contributeSpanFacts(facts)).rejects.toThrow(
          /no "contributeSpanFacts" sender/,
        );
      });
    });
  });
});
