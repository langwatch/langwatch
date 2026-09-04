/**
 * What the integration-method answer tells Customer.io.
 * @see specs/features/customer-io-nurturing-integration.feature
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fireIntegrationMethodNurturing,
  type IntegrationMethodValue,
  mapProductSelectionToIntegrationMethod,
} from "../nurturing-product-interest.service";
import {
  registerNoNurturingSink,
  registerNurturingSink,
  settle,
} from "./support/nurturing-harness";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

beforeEach(() => vi.clearAllMocks());
afterEach(() => registerNoNurturingSink());

describe("mapProductSelectionToIntegrationMethod", () => {
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
          expect(mapProductSelectionToIntegrationMethod(selection)).toBe(traitValue);
        },
      );
    });
  });
});

describe("fireIntegrationMethodNurturing", () => {
  describe("given a person on the integration-method screen", () => {
    describe("when they choose how they want to integrate", () => {
      /** @scenario "Integration-method identify call is fire-and-forget" */
      it("hands control back without waiting for Customer.io to answer", async () => {
        const sink = registerNurturingSink({ hanging: true });

        const answer = fireIntegrationMethodNurturing({
          userId: "user-1",
          integrationMethod: "platform",
        });
        await settle();

        expect(answer).toBeUndefined();
        expect(sink.sentTo("/identify")[0]).toMatchObject({
          traits: { integration_method: "platform" },
        });
      });
    });
  });

  describe("given Customer.io is unavailable", () => {
    describe("when they choose how they want to integrate", () => {
      /** @scenario "Integration-method identify failure does not break onboarding navigation" */
      it("returns normally and reports the failure for observability", async () => {
        const sink = registerNurturingSink({ failing: true });

        expect(() =>
          fireIntegrationMethodNurturing({ userId: "user-1", integrationMethod: "platform" }),
        ).not.toThrow();
        await settle();

        expect(sink.errorReporter.capture).toHaveBeenCalled();
      });
    });
  });
});
