/**
 * @vitest-environment node
 * The ElevenLabs webhook answers at the bare path it was registered at, and at its /api/v1 twin.
 */
import { describe, expect, it } from "vitest";

import { elevenLabsWebhookRest } from "../elevenlabs-webhook.rest.ts";

const declaration = elevenLabsWebhookRest.router();

describe("the ElevenLabs webhook REST family", () => {
  describe("given the declaration a process mounts", () => {
    it("serves the bare path and its /api/v1 twin", () => {
      expect(declaration.addressing).toBe("literal");
      expect(declaration.v1Twin).toBe(true);
      expect(declaration.routes.map((route) => route.path)).toEqual([
        "/api/elevenlabs/webhook/:modelProviderId",
      ]);
    });
  });
});
