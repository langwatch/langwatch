/** @vitest-environment node */
import { Temporal } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import { MemoryAuthSessionRepository } from "../../repositories/memory/memory.auth-session.repository.ts";
import { MemoryAuthDatabase } from "../../repositories/memory/memory.auth.database.ts";
import {
  type TwoStepProtocol,
  TwoStepVerificationService,
} from "../two-step-verification.service.ts";

const NOW = Temporal.Instant.from("2026-09-25T12:00:00Z");

function refusal(code: string): Error {
  return Object.assign(new Error(code), { body: { code } });
}

function twoStep(protocol: Partial<TwoStepProtocol> = {}) {
  const memory = MemoryAuthDatabase.create();
  const session = (id: string, rest: { userId: string; identifierId: string; amr: string[] }) =>
    memory.sessions.set(id, {
      id,
      sessionToken: id,
      impersonating: null,
      expires: id.startsWith("lapsed") ? NOW.subtract({ hours: 1 }) : NOW.add({ hours: 1 }),
      ...rest,
    });
  session("s-1", { userId: "u-1", identifierId: "i-1", amr: ["pwd", "otp"] });
  session("s-2", { userId: "u-2", identifierId: "i-2", amr: ["fed", "mfa"] });
  session("lapsed-3", { userId: "u-1", identifierId: "i-1", amr: ["hwk"] });

  const calls = {
    verifyTotp: vi.fn<TwoStepProtocol["verifyTotp"]>(protocol.verifyTotp ?? (async () => {})),
    disableTwoFactor: vi.fn<TwoStepProtocol["disableTwoFactor"]>(
      protocol.disableTwoFactor ?? (async () => {}),
    ),
  };

  return {
    calls,
    service: TwoStepVerificationService.create({
      sessions: MemoryAuthSessionRepository.create({ memory }),
      protocol: calls,
      now: () => NOW,
    }),
  };
}

describe("TwoStepVerificationService", () => {
  describe("when asked for one session's factors", () => {
    it("answers the amr the session recorded, and none for a session that is gone", async () => {
      const { service } = twoStep();

      await expect(service.findSessionAmr({ sessionId: "s-1" })).resolves.toEqual(["pwd", "otp"]);
      await expect(service.findSessionAmr({ sessionId: "gone" })).resolves.toEqual([]);
    });
  });

  describe("when asked what a connection's identifiers asserted", () => {
    it("answers the distinct amr of unexpired sessions minted through those identifiers", async () => {
      const { service } = twoStep();

      await expect(
        service.findAssertedAmr({ userIds: ["u-1", "u-2"], identifierIds: ["i-1"] }),
      ).resolves.toEqual(["pwd", "otp"]);
      await expect(
        service.findAssertedAmr({ userIds: ["u-1"], identifierIds: [] }),
      ).resolves.toEqual([]);
    });
  });

  describe("when turning two-step verification off", () => {
    it("checks the code before the password re-proof", async () => {
      const { service, calls } = twoStep();
      const headers = new Headers({ cookie: "c" });

      await service.disable({ headers, password: "pw", code: "123456" });

      expect(calls.verifyTotp).toHaveBeenCalledWith({ headers, code: "123456" });
      expect(calls.disableTwoFactor).toHaveBeenCalledWith({ headers, password: "pw" });
    });

    it("refuses a wrong code by its code and never reaches the password", async () => {
      const { service, calls } = twoStep({
        verifyTotp: async () => {
          throw refusal("INVALID_CODE");
        },
      });

      await expect(
        service.disable({ headers: new Headers(), code: "000000" }),
      ).rejects.toMatchObject({ code: "identity_mfa_code_invalid" });
      expect(calls.disableTwoFactor).not.toHaveBeenCalled();
    });

    it("names a wrong password, so the person looks at the right field", async () => {
      const { service } = twoStep({
        disableTwoFactor: async () => {
          throw refusal("INVALID_PASSWORD");
        },
      });

      await expect(
        service.disable({ headers: new Headers(), password: "wrong", code: "123456" }),
      ).rejects.toMatchObject({ code: "identity_mfa_password_invalid" });
    });

    it("lets a refusal it does not know through untouched", async () => {
      const unknown = new Error("database down");
      const { service } = twoStep({
        disableTwoFactor: async () => {
          throw unknown;
        },
      });

      await expect(service.disable({ headers: new Headers(), code: "123456" })).rejects.toBe(
        unknown,
      );
    });
  });
});
