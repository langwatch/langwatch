import { describe, expect, it, vi } from "vitest";

vi.mock("../../../env.mjs", () => ({
  env: { BASE_HOST: "https://self-hosted.example.com" },
}));
vi.mock("../providers", () => ({
  resolveEmailProvider: () => null,
}));

import { explainHandledError } from "~/features/errors/logic/presentation";
import { sendEmail } from "../emailSender";
import { EmailProviderNotConfiguredError } from "../errors";

describe("sendEmail", () => {
  describe("given an installation with no email provider", () => {
    describe("when an email is sent", () => {
      /** @scenario "An email test on an installation without email says email is not set up" */
      it("refuses with the email-not-configured handled error", async () => {
        const error = await sendEmail({
          to: ["someone@example.com"],
          subject: "Test",
          html: "<p>hi</p>",
        }).catch((e: unknown) => e);

        expect(error).toBeInstanceOf(EmailProviderNotConfiguredError);
        expect(error).toMatchObject({
          code: "email_provider_not_configured",
          httpStatus: 422,
        });
      });

      it("tells the reader email is not set up on this installation", () => {
        const error = new EmailProviderNotConfiguredError();
        const copy = explainHandledError({
          code: error.code,
          meta: error.meta,
          httpStatus: error.httpStatus,
          fault: error.fault,
          tips: error.tips,
          docsUrl: error.docsUrl,
          traceId: undefined,
          reasons: [],
        });
        expect(copy.title).toBe("Email is not set up on this installation");
      });
    });
  });
});
