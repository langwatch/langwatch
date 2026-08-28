import { beforeEach, describe, expect, it, vi } from "vitest";

const { constructStripe } = vi.hoisted(() => ({
  constructStripe: vi.fn(),
}));

vi.mock("stripe", () => ({ default: constructStripe }));

import { AppStripeRuntime, resolveStripeRuntimeConfig } from "../stripe.runtime";

describe("AppStripeRuntime", () => {
  beforeEach(() => {
    constructStripe.mockReset();
    constructStripe.mockImplementation(function StripeMock() {
      return {};
    });
  });

  it("constructs one client with the established SDK policy", async () => {
    const runtime = AppStripeRuntime.create(
      resolveStripeRuntimeConfig({ STRIPE_SECRET_KEY: "sk_test_process" }),
    );

    expect(constructStripe).toHaveBeenCalledExactlyOnceWith("sk_test_process", {
      apiVersion: "2024-04-10",
      maxNetworkRetries: 1,
      telemetry: true,
    });
    await expect(runtime.close()).resolves.toBeUndefined();
  });

  it("rejects SaaS composition without a Stripe secret key", () => {
    expect(() => AppStripeRuntime.create(resolveStripeRuntimeConfig({}))).toThrow(
      "A Stripe secret key is required for SaaS billing runtime",
    );
    expect(constructStripe).not.toHaveBeenCalled();
  });
});
