/**
 * The people list names a Billing-only member or invitation by its flag, not by the Lite role it
 * is stored on (ADR-205).
 */
import { describe, expect, it } from "vitest";

import { seatLabel } from "../organization-user-role-field.tsx";

describe("seatLabel", () => {
  it("names a Billing-only Lite membership Billing only", () => {
    expect(seatLabel({ role: "EXTERNAL", billingOnly: true })).toBe("Billing only");
  });

  it("names a plain Lite membership Lite Member", () => {
    expect(seatLabel({ role: "EXTERNAL" })).toBe("Lite Member");
  });

  it("names the other seats by their role", () => {
    expect(seatLabel({ role: "ADMIN" })).toBe("Admin");
    expect(seatLabel({ role: "DEVELOPER", billingOnly: false })).toBe("Developer");
  });
});
