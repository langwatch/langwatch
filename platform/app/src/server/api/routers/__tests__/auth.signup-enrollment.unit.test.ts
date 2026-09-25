import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInnerTRPCContext } from "../../trpc";
import { authRouter } from "../auth";

const {
  validateAddressProof,
  validateUnconfirmedAddressProof,
  localSignUpDecision,
  hasEmailProvider,
} = vi.hoisted(() => ({
  validateAddressProof: vi.fn(),
  validateUnconfirmedAddressProof: vi.fn(),
  localSignUpDecision: vi.fn(),
  hasEmailProvider: vi.fn(),
}));

vi.mock("~/server/app-layer/identity/runtime", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("~/server/app-layer/identity/runtime")
  >()),
  localSignUpDecision,
  signUpVerification: () => ({
    validateAddressProof,
    validateUnconfirmedAddressProof,
  }),
}));

vi.mock("~/server/mailer/providers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/server/mailer/providers")>()),
  hasEmailProvider,
  isEmailUnconfigured: () => !hasEmailProvider(),
}));

const passwordAndPasskey = [
  { id: "passkey", kind: "passkey", connectionId: null },
  { id: "password", kind: "password", connectionId: null },
];

describe("auth.signUpEnrollment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    validateAddressProof.mockResolvedValue(true);
    validateUnconfirmedAddressProof.mockResolvedValue(false);
    hasEmailProvider.mockReturnValue(true);
    localSignUpDecision.mockResolvedValue({
      outcome: "enroll",
      methodSet: [{ id: "password", kind: "password", connectionId: null }],
      reasonCode: "identifier_unknown",
    });
  });

  const caller = () =>
    authRouter.createCaller(createInnerTRPCContext({ session: null }));

  it("requires a matching live proof before deciding enrollment", async () => {
    validateAddressProof.mockResolvedValue(false);

    await expect(
      caller().signUpEnrollment({
        email: "sam@example.com",
        addressProof: "spent-or-borrowed",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(localSignUpDecision).not.toHaveBeenCalled();
  });

  it("decides only for the address bound to the proof", async () => {
    await caller().signUpEnrollment({
      email: "Sam@Example.com",
      addressProof: "proof-1",
    });

    expect(validateAddressProof).toHaveBeenCalledWith({
      token: "proof-1",
      email: "Sam@Example.com",
    });
    expect(localSignUpDecision).toHaveBeenCalledWith("Sam@Example.com");
  });

  describe("given an installation with no email provider", () => {
    beforeEach(() => {
      hasEmailProvider.mockReturnValue(false);
      validateAddressProof.mockResolvedValue(false);
      validateUnconfirmedAddressProof.mockResolvedValue(true);
      localSignUpDecision.mockResolvedValue({
        outcome: "enroll",
        methodSet: passwordAndPasskey,
        reasonCode: "identifier_unknown",
      });
    });

    /** @scenario "An installation that cannot send email signs up with a password and leaves the address unconfirmed" */
    it("accepts an unconfirmed proof and offers no passkey sign-up", async () => {
      const decision = await caller().signUpEnrollment({
        email: "sam@example.com",
        addressProof: "unconfirmed-proof",
      });

      expect(validateUnconfirmedAddressProof).toHaveBeenCalledWith({
        token: "unconfirmed-proof",
        email: "sam@example.com",
      });
      expect(decision.methodSet.map((method) => method.kind)).toEqual([
        "password",
      ]);
    });

    it("keeps the passkey for a confirmed proof", async () => {
      validateAddressProof.mockResolvedValue(true);

      const decision = await caller().signUpEnrollment({
        email: "sam@example.com",
        addressProof: "confirmed-proof",
      });

      expect(decision.methodSet).toEqual(passwordAndPasskey);
    });
  });

  describe("given an installation that can send email", () => {
    /** @scenario "An unconfirmed address proof is refused once the installation can send email" */
    it("refuses an unconfirmed proof", async () => {
      validateAddressProof.mockResolvedValue(false);
      validateUnconfirmedAddressProof.mockResolvedValue(true);

      await expect(
        caller().signUpEnrollment({
          email: "sam@example.com",
          addressProof: "unconfirmed-proof",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(validateUnconfirmedAddressProof).not.toHaveBeenCalled();
      expect(localSignUpDecision).not.toHaveBeenCalled();
    });
  });
});
