import { describe, expect, it } from "vitest";

import { isStripeTestModeKey } from "../stripe-mode.rules.ts";

describe("isStripeTestModeKey()", () => {
  it.each(["sk_test_abc", "rk_test_abc", " sk_test_abc "])("reads %j as test mode", (secretKey) => {
    expect(isStripeTestModeKey({ secretKey })).toBe(true);
  });

  it.each(["sk_live_abc", "rk_live_abc", "", undefined])("reads %j as live mode", (secretKey) => {
    expect(isStripeTestModeKey({ secretKey })).toBe(false);
  });
});
