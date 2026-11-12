import { markHandledGlobally } from "@langwatch/browser-host/errors";
import { describe, expect, it } from "vitest";

import type { TalkEvent } from "../../model/talk-to-it-machine.ts";
import { mintSession } from "../talk-to-it-session.ts";

function mintRefusedWith(error: Error) {
  const events: TalkEvent[] = [];
  const props = {
    projectId: "project_1",
    transport: "elevenlabs_convai" as const,
    agentId: "vendor_agent",
    scenarioId: "scenario_1",
    sessionClient: {
      mint: async () => {
        throw error;
      },
      finish: async () => {
        throw error;
      },
      describeFailure: () => ({ code: "mint_failed" as const, message: error.message }),
    },
  };
  const refs = { createdRowId: { current: undefined } };
  return { events, run: () => mintSession({ props, refs, dispatch: (e) => events.push(e) }) };
}

describe("mintSession", () => {
  describe("when the global handler already took the refusal (run cap upgrade prompt)", () => {
    it("returns the panel to idle without a call error", async () => {
      const error = new Error("scenario run cap reached");
      markHandledGlobally(error);
      const { events, run } = mintRefusedWith(error);

      expect(await run()).toBeNull();
      expect(events).toEqual([{ type: "RETRY" }]);
    });
  });

  describe("when the mint fails for another reason", () => {
    it("shows the retryable call error", async () => {
      const { events, run } = mintRefusedWith(new Error("provider down"));

      await run();

      expect(events).toEqual([
        { type: "MINT_FAILED", code: "mint_failed", message: "provider down" },
      ]);
    });
  });
});
