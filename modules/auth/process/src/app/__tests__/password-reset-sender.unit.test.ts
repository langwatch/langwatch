/**
 * Where a requested password reset goes: main's reset mail, its link rooted at
 * this deployment's own reset page.
 * @see specs/auth/password-reset.feature
 */
import { AuthUnavailableError } from "@langwatch/auth-contract";
import { describe, expect, it } from "vitest";

import { passwordResetMailChannels } from "../../channels/password-reset-mail-channels.registry.ts";
import { passwordResetSender } from "../auth-composition.build.ts";

describe("sending a requested password reset", () => {
  describe("given the process names its public base URL", () => {
    /** @scenario The reset link is rooted at the deployment's own URL and carries the token */
    it("mails the user a link to this deployment's reset page carrying the token", async () => {
      const mail = passwordResetMailChannels.memory.create();
      const send = passwordResetSender({
        mail,
        publicBaseUrl: "https://langwatch.example.com",
        processName: "api",
      });

      await send({ email: "person@example.com", token: "tok/with+chars" });

      expect(mail.sent).toEqual([
        {
          email: "person@example.com",
          resetUrl: "https://langwatch.example.com/auth/reset-password?token=tok%2Fwith%2Bchars",
        },
      ]);
    });
  });

  describe("given the process names no public base URL", () => {
    it("refuses by name and mails nothing", async () => {
      const mail = passwordResetMailChannels.memory.create();
      const send = passwordResetSender({ mail, publicBaseUrl: undefined, processName: "api" });

      await expect(send({ email: "person@example.com", token: "tok" })).rejects.toBeInstanceOf(
        AuthUnavailableError,
      );
      expect(mail.sent).toEqual([]);
    });
  });
});
