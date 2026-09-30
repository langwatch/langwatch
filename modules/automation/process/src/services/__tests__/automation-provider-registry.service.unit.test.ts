import type { TriggerAction } from "@langwatch/automation-contract";
import { describe, expect, it } from "vitest";

import { AutomationProviderRegistryService } from "../automation-provider-registry.service.ts";

const registry = AutomationProviderRegistryService.create({
  encrypt: (value: string) => `enc(${value})`,
  decrypt: (value: string) => value,
});

// wrong-typed input: a stored row can name a channel this build no longer offers
const RETIRED_CHANNEL = "SEND_CARRIER_PIGEON" as TriggerAction;

describe("AutomationProviderRegistryService", () => {
  describe("given a stored row naming a channel this server does not offer", () => {
    /** @scenario "Reading an unknown delivery channel returns nothing" */
    it("returns an empty delivery configuration", () => {
      expect(
        registry.redactActionParamsFor(RETIRED_CHANNEL, {
          pigeonWebhook: "https://hooks.slack.com/services/T0/B0/XXXX",
        }),
      ).toEqual({});
    });
  });

  describe("when a delivery configuration is saved for a channel this server does not offer", () => {
    /** @scenario "A delivery channel the server no longer offers is written as it was sent" */
    it("stores the configuration as the caller sent it", async () => {
      const incoming = { pigeonWebhook: "https://hooks.example.com/x", retries: 2 };

      const stored = await registry.persistActionParamsFor(RETIRED_CHANNEL, {
        incoming,
        loadExisting: async () => undefined,
      });

      expect(stored).toEqual(incoming);
    });
  });
});
