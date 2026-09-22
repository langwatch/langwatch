import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInnerTRPCContext } from "../../trpc";
import { authRouter } from "../auth";

const { validateAddressProof, localSignUpDecision } = vi.hoisted(() => ({
  validateAddressProof: vi.fn(),
  localSignUpDecision: vi.fn(),
}));

vi.mock("~/server/app-layer/identity/runtime", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("~/server/app-layer/identity/runtime")
  >()),
  localSignUpDecision,
  signUpVerification: () => ({ validateAddressProof }),
}));

describe("auth.signUpEnrollment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    validateAddressProof.mockResolvedValue(true);
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
});
