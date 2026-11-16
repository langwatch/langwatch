/**
 * A trace rule's SEND_WEBHOOK action posting to the stop route: the body its Liquid template
 * renders, with the organisation key in the action's secret Authorization header.
 * Spec: enterprise/modules/governance/specs/agent-kill-switch.feature
 */
import type { AgentStopView } from "@langwatch/enterprise-governance-contract";
import { describe, expect, it } from "vitest";

import { AGENT_ID, buildKillSwitchRest, KEYS } from "./support/kill-switch-rest.fixture.ts";

/**
 * What the automation renders for the template in docs/governance/kill-switch.mdx. It parses
 * and re-serialises a JSON body, so this is the exact body it posts.
 */
const RENDERED_BODY = JSON.stringify({
  reason: "Trace rule Prompt injection matched https://app.langwatch.ai/acme/messages/trace_123",
  severity: "critical",
});

describe("the stop route as a trace rule's webhook action calls it", () => {
  describe("when the automation posts its rendered body with the API key header", () => {
    /** @scenario "A trace rule's webhook action can call the stop route" */
    it("records the stop with trigger api_key and the automation's reason", async () => {
      const { call, eventing } = await buildKillSwitchRest();

      const response = await call({
        method: "POST",
        path: `/api/governance/agents/${AGENT_ID}/stop`,
        body: RENDERED_BODY,
        key: KEYS.traceRule,
      });
      const body = (await response.json()) as { data: AgentStopView };

      expect(response.status).toBe(202);
      expect(body.data).toMatchObject({
        trigger: "api_key",
        severity: "critical",
        approval: "immediate",
        reason:
          "Trace rule Prompt injection matched https://app.langwatch.ai/acme/messages/trace_123",
      });
      await eventing.close();
    });
  });
});
