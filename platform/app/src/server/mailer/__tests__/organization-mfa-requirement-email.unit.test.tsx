import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../emailSender", () => ({ sendEmail: vi.fn() }));

import { sendEmail } from "../emailSender";
import { sendOrganizationMfaRequirementEmail } from "../organization-mfa-requirement-email";

describe("sendOrganizationMfaRequirementEmail", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    [true, "Two-step verification is now required", "turned on"],
    [false, "Two-step verification is no longer required", "turned off"],
  ] as const)(
    "renders the required=%s change for one member",
    async (required, title, action) => {
      await sendOrganizationMfaRequirementEmail({
        to: "sam@example.com",
        organizationName: "Acme",
        actorName: "Ana Admin",
        required,
      });

      const delivery = vi.mocked(sendEmail).mock.calls[0]?.[0];
      expect(delivery).toMatchObject({
        to: "sam@example.com",
        subject: `${title} for Acme`,
      });
      expect(delivery?.html).toContain("Ana Admin");
      expect(delivery?.html).toContain(action);
      expect(delivery?.html).toContain("Acme");
    },
  );
});
