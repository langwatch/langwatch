/**
 * The finish body carries the call's span, never a browser claim that the limit cut it.
 * @see specs/features/agents/voice-agents-v1.feature
 */
import { describe, expect, it } from "vitest";

import { voiceSessionFinishInputSchema } from "../voice-session.schemas.ts";

describe("voiceSessionFinishInputSchema", () => {
  describe("given a finish body that sets isCutAtLimit", () => {
    /** @scenario "A finish body that claims the call was cut carries no flag to the server" */
    it("strips the flag, so the server derives the marker from the span alone", () => {
      const parsed = voiceSessionFinishInputSchema.parse({
        projectId: "project_1",
        sessionToken: "token",
        startedAt: 1_000,
        endedAt: 2_000,
        isCutAtLimit: true,
      });

      expect(parsed).not.toHaveProperty("isCutAtLimit");
      expect(parsed).toMatchObject({ startedAt: 1_000, endedAt: 2_000 });
    });
  });
});
