/**
 * Setting two-step verification up and issuing fresh backup codes, as the
 * endpoints answer them.
 * Spec: specs/identity/mfa-and-session-shape.feature
 */

import { describe, expect, it, vi } from "vitest";

import {
  confirmUiTwoStepSetup,
  regenerateUiBackupCodes,
  startUiTwoStepSetup,
  type UiTwoFactorPost,
} from "../ui-two-factor.ts";

const SETUP_URI = "otpauth://totp/LangWatch:sam@acme.com?secret=JBSWY3DPEHPK3PXP&issuer=LangWatch";
const REFUSAL = { code: "identity_mfa_password_invalid", status: 400 };

function answering(answer: Awaited<ReturnType<UiTwoFactorPost>>) {
  return vi.fn<UiTwoFactorPost>(() => Promise.resolve(answer));
}

describe("startUiTwoStepSetup", () => {
  describe("given an account that holds a password", () => {
    it("sends the password and hands back the setup link and the codes it will hold", async () => {
      const post = answering({
        ok: true,
        value: { totpURI: SETUP_URI, backupCodes: ["a1", "b2"] },
      });

      const answer = await startUiTwoStepSetup({ password: "hunter2" }, post);

      expect(post).toHaveBeenCalledWith("enable", { password: "hunter2" });
      expect(answer).toEqual({
        ok: true,
        value: { setupUri: SETUP_URI, backupCodes: ["a1", "b2"] },
      });
    });
  });

  describe("given an account that holds no password", () => {
    it("sends no password at all rather than an empty one", async () => {
      const post = answering({ ok: true, value: { totpURI: SETUP_URI, backupCodes: [] } });

      await startUiTwoStepSetup({}, post);

      expect(post).toHaveBeenCalledWith("enable", {});
    });
  });

  describe("when the endpoint refuses", () => {
    it("hands the refusal back as it was answered", async () => {
      const answer = await startUiTwoStepSetup(
        { password: "wrong" },
        answering({ ok: false, error: REFUSAL }),
      );

      expect(answer).toEqual({ ok: false, error: REFUSAL });
    });
  });

  describe("when the answer carries no setup link", () => {
    it("reads as a refusal rather than a setup with nothing to scan", async () => {
      const answer = await startUiTwoStepSetup({}, answering({ ok: true, value: {} }));

      expect(answer.ok).toBe(false);
    });
  });
});

describe("confirmUiTwoStepSetup", () => {
  it("sends the first code the authenticator produced", async () => {
    const post = answering({ ok: true, value: { token: "t" } });

    const answer = await confirmUiTwoStepSetup({ code: "123456" }, post);

    expect(post).toHaveBeenCalledWith("verify-totp", { code: "123456" });
    expect(answer).toEqual({ ok: true, value: { confirmed: true } });
  });
});

describe("regenerateUiBackupCodes", () => {
  it("hands back only the new set", async () => {
    const post = answering({ ok: true, value: { status: true, backupCodes: ["c3", "d4"] } });

    const answer = await regenerateUiBackupCodes({ password: "hunter2" }, post);

    expect(post).toHaveBeenCalledWith("generate-backup-codes", { password: "hunter2" });
    expect(answer).toEqual({ ok: true, value: { backupCodes: ["c3", "d4"] } });
  });
});
