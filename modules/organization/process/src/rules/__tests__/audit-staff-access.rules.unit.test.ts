/** Spec: modules/staff-access/specs/staff-access-use.feature */
import { describe, expect, it } from "vitest";

import { extractAuditStaffAccess } from "../audit-staff-access.rules.ts";

describe("extractAuditStaffAccess", () => {
  it("reads the gate's own staff row from its metadata", () => {
    expect(
      extractAuditStaffAccess({
        action: "staffAccess.write",
        metadata: { principal: "LangWatch Support", reason: "ACME asked", path: "/api/x" },
      }),
    ).toEqual({ principal: "LangWatch Support", reason: "ACME asked" });
  });

  it("reads a change made with a staff key from its staff fields", () => {
    expect(
      extractAuditStaffAccess({
        action: "monitors.create",
        metadata: {
          channel: "api",
          staffPrincipal: "LangWatch Support",
          staffReason: "ACME asked",
        },
      }),
    ).toEqual({ principal: "LangWatch Support", reason: "ACME asked" });
  });

  it("answers no reason when the change carries none", () => {
    expect(
      extractAuditStaffAccess({
        action: "prompts.syncFromSource",
        metadata: { staffPrincipal: "LangWatch Support" },
      }),
    ).toEqual({ principal: "LangWatch Support", reason: null });
  });

  it("answers nothing for any other row", () => {
    expect(
      extractAuditStaffAccess({ action: "monitors.create", metadata: { channel: "api" } }),
    ).toBeUndefined();
    expect(extractAuditStaffAccess({ action: "monitors.create", metadata: null })).toBeUndefined();
  });
});
