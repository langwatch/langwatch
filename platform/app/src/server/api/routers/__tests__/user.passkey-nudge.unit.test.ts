import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInnerTRPCContext } from "../../trpc";
import { userRouter } from "../user";

const { deploymentOffersPasskeysMock } = vi.hoisted(() => ({
  deploymentOffersPasskeysMock: vi.fn(),
}));

vi.mock("~/server/app-layer/identity/signin-method-policy", () => ({
  deploymentOffersPasskeys: deploymentOffersPasskeysMock,
}));

vi.mock("~/runtime/app/features/audit-log", () => ({
  auditLog: vi.fn().mockResolvedValue(undefined),
}));

describe("userRouter.passkeyNudge", () => {
  let getPasskeyNudgeStatus: ReturnType<typeof vi.fn>;
  let dismissPasskeyNudge: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    deploymentOffersPasskeysMock.mockReturnValue(true);
    getPasskeyNudgeStatus = vi.fn().mockResolvedValue({ hasPasskey: false, dismissedAt: null });
    dismissPasskeyNudge = vi.fn().mockResolvedValue(undefined);
  });

  const createCaller = () => {
    const context = createInnerTRPCContext({
      session: {
        user: { id: "user-1", email: "sam@acme.com" },
        expires: "2099-01-01",
      },
      app: {
        users: { getPasskeyNudgeStatus, dismissPasskeyNudge },
        permissions: {
          checkScopeLineage: vi.fn().mockResolvedValue({ kind: "consistent" }),
        },
      } as never,
    });
    return userRouter.createCaller(context);
  };

  it("offers passkeys when the deployment and user status permit it", async () => {
    await expect(createCaller().passkeyNudge({})).resolves.toEqual({ offer: true });
    expect(getPasskeyNudgeStatus).toHaveBeenCalledWith({ id: "user-1" });
  });

  it("does not read user state where the deployment does not offer passkeys", async () => {
    deploymentOffersPasskeysMock.mockReturnValue(false);

    await expect(createCaller().passkeyNudge({})).resolves.toEqual({ offer: false });
    expect(getPasskeyNudgeStatus).not.toHaveBeenCalled();
  });

  it("does not offer another passkey to someone who already has one", async () => {
    getPasskeyNudgeStatus.mockResolvedValue({ hasPasskey: true, dismissedAt: null });

    await expect(createCaller().passkeyNudge({})).resolves.toEqual({ offer: false });
  });

  it("records a dismissal through the composed User service", async () => {
    await expect(createCaller().dismissPasskeyNudge({})).resolves.toEqual({ success: true });
    expect(dismissPasskeyNudge).toHaveBeenCalledWith({ id: "user-1" });
  });
});
