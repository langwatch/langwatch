/**
 * What the integration-method answer tells Customer.io.
 * @see specs/features/customer-io-nurturing-integration.feature
 */
import { describe, expect, it } from "vitest";

import {
  fireIntegrationMethod,
  integrationMethodFor,
  type IntegrationMethodValue,
} from "../nurturing-product-interest-service.rules.ts";

describe("integrationMethodFor", () => {
  describe("given the integration-method onboarding screen", () => {
    describe("when a selection is made", () => {
      /** @scenario "Integration-method selection maps to canonical trait value" */
      it.each([
        ["via-claude-code", "coding_agent"],
        ["via-platform", "platform"],
        ["via-claude-desktop", "mcp"],
        ["manually", "manual_sdk"],
      ] as [string, IntegrationMethodValue][])(
        "maps %s to the %s trait value",
        (selection, traitValue) => {
          expect(integrationMethodFor(selection)).toBe(traitValue);
        },
      );
    });
  });
});

describe("fireIntegrationMethod", () => {
  describe("given a person on the integration-method screen", () => {
    describe("when they choose how they want to integrate", () => {
      /** @scenario "Integration-method identify call is fire-and-forget" */
      it("decides on one identify call, carrying no promise to wait on", () => {
        const calls = fireIntegrationMethod({ userId: "user-1", integrationMethod: "platform" });

        expect(calls).toEqual([
          { type: "identify", userId: "user-1", traits: { integration_method: "platform" } },
        ]);
      });
    });
  });
});
