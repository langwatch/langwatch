/**
 * Each Flight Deck widget's not-connected face names its own source, rather than
 * a generic "connect something" message, and its button opens that source's own
 * setup page. The widget's stored code only reaches that face once its own
 * count query comes back with no rows.
 */

import { describe, expect, it } from "vitest";

import { FEEDBACK_CODE, QUALITY_CODE } from "../model/flight-deck-chart-widgets.ts";
import {
  CODING_AGENTS_CODE,
  GATEWAY_CODE,
  SCENARIOS_CODE,
} from "../model/flight-deck-table-widgets.ts";
import { CALLS_TO_ACTION } from "../model/widget-calls-to-action.ts";

const OWN_CALL_TO_ACTION = [
  {
    widget: "Scenario results",
    code: SCENARIOS_CODE,
    source: "scenarios",
    title: "Run a scenario",
    target: "scenarios",
    noRowsCheck: "if (runs === 0) return <Panel><CallToAction /></Panel>;",
  },
  {
    widget: "Quality signal",
    code: QUALITY_CODE,
    source: "judges",
    title: "Add a judge",
    target: "onlineEvaluations",
    noRowsCheck: "if (passRate.data.length === 0) return <Panel><CallToAction /></Panel>;",
  },
  {
    widget: "User feedback",
    code: FEEDBACK_CODE,
    source: "feedback",
    title: "Collect feedback",
    target: "annotations",
    noRowsCheck: "if (up + down === 0) return <Panel><CallToAction /></Panel>;",
  },
  {
    widget: "Gateway routing",
    code: GATEWAY_CODE,
    source: "gateway",
    title: "Route via the Gateway",
    target: "gatewayVirtualKeys",
    noRowsCheck: "if (main.data.length === 0) return <Panel><CallToAction /></Panel>;",
  },
  {
    widget: "Your coding agents",
    code: CODING_AGENTS_CODE,
    source: "codingAgents",
    title: "Connect your coding agents",
    target: "codingSessions",
    noRowsCheck: "if (agents.data.length === 0) return <Panel><CallToAction /></Panel>;",
  },
] as const;

describe.each(OWN_CALL_TO_ACTION)(
  "given the $widget widget's not-connected face",
  ({ code, source, title, target, noRowsCheck }) => {
    /** @scenario "AC6 Unconnected source shows a call to action" */
    /** @scenario "AC25 Scenario results shows its own call to action before any row exists" */
    /** @scenario "AC25 Quality signal shows its own call to action before any row exists" */
    /** @scenario "AC25 User feedback shows its own call to action before any row exists" */
    /** @scenario "AC25 Gateway routing shows its own call to action before any row exists" */
    /** @scenario "AC25 Your coding agents shows its own call to action before any row exists" */
    it("names its own source rather than a generic message, and its button opens its own setup page", () => {
      expect(CALLS_TO_ACTION[source].title).toBe(title);
      expect(CALLS_TO_ACTION[source].target).toBe(target);
    });

    /** @scenario "AC6 Unconnected source shows a call to action" */
    it("renders that call to action as soon as its own count query comes back with no rows", () => {
      expect(code).toContain(noRowsCheck);
    });
  },
);
