/**
 * Who the run drawer waits for between two messages.
 *
 * @see specs/features/agent-testing/side-by-side-run-drawer.feature
 */

import { describe, expect, it } from "vitest";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import { nextSpeakerOf } from "../next-speaker";

const running = ScenarioRunStatus.IN_PROGRESS;

describe("nextSpeakerOf", () => {
  describe("given a run that is still going", () => {
    /** @scenario "A run waiting for the agent shows it writing" */
    it("waits for the agent after a user message", () => {
      expect(
        nextSpeakerOf({ messages: [{ role: "user" }], status: running }),
      ).toBe("assistant");
    });

    /** @scenario "A run waiting for the judge shows nothing writing" */
    it("waits for no message after an agent message, as the judge reads next", () => {
      expect(
        nextSpeakerOf({
          messages: [{ role: "user" }, { role: "assistant" }],
          status: running,
        }),
      ).toBeNull();
    });

    /** @scenario "A run waiting for the agent shows it writing" */
    it("waits for the simulated user when no message has been written", () => {
      expect(nextSpeakerOf({ messages: [], status: running })).toBe("user");
    });

    /** @scenario "A run waiting for the agent shows it writing" */
    it("keeps waiting for the agent while it works through its tools", () => {
      expect(
        nextSpeakerOf({
          messages: [
            { role: "user" },
            { role: "assistant", tool_calls: [{ id: "call_1" }] },
            { role: "tool" },
          ],
          status: running,
        }),
      ).toBe("assistant");
    });

    /** @scenario "A run waiting for the judge shows nothing writing" */
    it("reads the streamed message as the last one", () => {
      expect(
        nextSpeakerOf({
          messages: [{ role: "user" }],
          streamingMessages: [{ role: "assistant" }],
          status: running,
        }),
      ).toBeNull();
    });
  });

  describe("given a run that has settled", () => {
    /** @scenario "A run waiting for the judge shows nothing writing" */
    it("waits for nobody", () => {
      expect(
        nextSpeakerOf({
          messages: [{ role: "user" }],
          status: ScenarioRunStatus.SUCCESS,
        }),
      ).toBeNull();
    });
  });
});
