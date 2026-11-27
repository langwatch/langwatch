/** @see modules/langy/specs/langy-ops-turn-facts.feature */
import type { LangyTurnToolCall } from "@langwatch/langy-contract";
import { describe, expect, it } from "vitest";

import { failureCodeOf, targetOf, toolLabelOf } from "../langy-turn-facts.rules.ts";

/** A snake_case value the error registry does not know, as a leaked key's text could be. */
const KEY_SHAPED = ["acme", "key", "not", "a", "code"].join("_");

function call(fields: Partial<LangyTurnToolCall> & { toolName: string }): LangyTurnToolCall {
  return { toolCallId: "call_1", status: "succeeded", ...fields } as LangyTurnToolCall;
}

describe("given a failed turn's stored error", () => {
  /** @scenario "A stored failure collapses to its error code" */
  it("reads the handled error's code, a bare code, or other for free text", () => {
    expect(failureCodeOf(JSON.stringify({ code: "langy_turn_timeout", meta: {} }))).toBe(
      "langy_turn_timeout",
    );
    expect(failureCodeOf("langy_agent_at_capacity")).toBe("langy_agent_at_capacity");
    expect(failureCodeOf("The ACME key leaked: sk-123")).toBe("other");
    expect(failureCodeOf(JSON.stringify({ code: "Not A Code" }))).toBe("other");
    expect(failureCodeOf(KEY_SHAPED)).toBe("other");
    expect(failureCodeOf(JSON.stringify({ code: KEY_SHAPED }))).toBe("other");
  });
});

describe("given tool calls", () => {
  /** @scenario "A tool call is labelled by its tool and its LangWatch CLI group" */
  it("labels CLI calls by group and the rest by tool name", () => {
    expect(
      toolLabelOf(
        call({ toolName: "bash", command: 'cd x && langwatch trace search --query "hi"' }),
      ),
    ).toBe("langwatch.trace");
    expect(toolLabelOf(call({ toolName: "bash", command: "ls -la" }))).toBe("bash");
    expect(toolLabelOf(call({ toolName: "Weird Tool!" }))).toBe("other");
    expect(toolLabelOf(call({ toolName: "bash", command: "langwatch acmesecret run" }))).toBe(
      "langwatch.other",
    );
  });

  /** @scenario "A tool call's target is an id-shaped value of an id field" */
  it("takes the target from an id field or an id flag, and only an id-shaped value", () => {
    expect(targetOf(call({ toolName: "ui_action", input: { dashboardId: "dash_123" } }))).toEqual({
      kind: "dashboard",
      id: "dash_123",
    });
    expect(
      targetOf(
        call({
          toolName: "bash",
          command: "langwatch dashboards widget create --dashboard-id dash_9",
        }),
      ),
    ).toEqual({ kind: "dashboard", id: "dash_9" });
    expect(
      targetOf(
        call({ toolName: "bash", command: "langwatch dashboards show --dashboard-id 'dash_10'" }),
      ),
    ).toEqual({ kind: "dashboard", id: "dash_10" });
    expect(
      targetOf(
        call({ toolName: "bash", command: 'langwatch dashboards show --dashboard-id="dash_11"' }),
      ),
    ).toEqual({ kind: "dashboard", id: "dash_11" });
    expect(
      targetOf(
        call({ toolName: "bash", command: "langwatch dashboards show --dashboard-id 'dash 12'" }),
      ),
    ).toEqual({ kind: null, id: null });
    expect(
      targetOf(call({ toolName: "ui_action", input: { dashboardId: "my open board" } })),
    ).toEqual({ kind: null, id: null });
    expect(targetOf(call({ toolName: "bash", command: "ls" }))).toEqual({ kind: null, id: null });
  });
});
