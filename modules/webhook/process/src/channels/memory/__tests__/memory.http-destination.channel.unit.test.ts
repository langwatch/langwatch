import { createSsrfUrlValidator } from "@langwatch/egress";
import { describe, expect, it } from "vitest";

import { MemoryHttpDestinationChannel } from "../memory.http-destination.channel.ts";

/** Spec: modules/webhook/specs/webhook-egress.feature */
describe("MemoryHttpDestinationChannel", () => {
  describe("when asked to send to a private address", () => {
    /** @scenario "The memory HTTP channel records a delivery and sends nothing" */
    it("records the request and answers 200 without any fence", async () => {
      const channel = MemoryHttpDestinationChannel.create();
      const request = {
        url: "https://10.0.0.1/hooks/spend",
        body: "{}",
        headers: { "Content-Type": "application/json" },
        contextLabel: "test",
        validateUrl: createSsrfUrlValidator({ blockLocal: true, allowedHosts: [] }),
      };

      await expect(channel.send(request)).resolves.toMatchObject({ status: 200, body: "" });

      expect(channel.requests).toEqual([request]);
    });
  });
});
