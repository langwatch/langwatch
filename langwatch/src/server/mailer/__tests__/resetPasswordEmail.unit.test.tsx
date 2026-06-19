import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendEmail } from "../emailSender";
import { sendResetPasswordEmail } from "../resetPasswordEmail";

vi.mock("../emailSender", () => ({
  sendEmail: vi.fn(),
}));

const baseParams = {
  email: "user@acme.test",
  resetUrl:
    "https://app.langwatch.ai/auth/reset-password?token=tok_abc123def456",
};

describe("sendResetPasswordEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("when sending the reset email", () => {
    /** @scenario The reset email is sent through the existing email infrastructure */
    it("dispatches via the shared sendEmail mailer to the user with a LangWatch password subject", async () => {
      await sendResetPasswordEmail(baseParams);

      expect(sendEmail).toHaveBeenCalledTimes(1);
      const call = vi.mocked(sendEmail).mock.calls[0]!;
      expect(call[0].to).toBe("user@acme.test");
      expect(call[0].subject).toContain("LangWatch");
      expect(call[0].subject.toLowerCase()).toContain("password");
    });
  });

  describe("when rendering the email body", () => {
    /** @scenario The reset email links to the reset page with a one-time token */
    it("contains a button linking to the reset page carrying the token", async () => {
      await sendResetPasswordEmail(baseParams);

      const call = vi.mocked(sendEmail).mock.calls[0]!;
      expect(call[0].html).toContain("/auth/reset-password");
      expect(call[0].html).toContain("tok_abc123def456");
      expect(call[0].html).toContain("Reset password");
    });

    /** @scenario The reset email tells the user it expires and is safe to ignore */
    it("explains the link expires and can be ignored if unrequested", async () => {
      await sendResetPasswordEmail(baseParams);

      const call = vi.mocked(sendEmail).mock.calls[0]!;
      expect(call[0].html).toContain("expires");
      expect(call[0].html).toContain("ignore");
    });

    it("addresses the email to the account it was requested for", async () => {
      await sendResetPasswordEmail(baseParams);

      const call = vi.mocked(sendEmail).mock.calls[0]!;
      expect(call[0].html).toContain("user@acme.test");
    });
  });
});
