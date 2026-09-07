import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInnerTRPCContext } from "../../trpc";
import { userRouter } from "../user";

vi.mock("../../../../env.mjs", () => ({
  env: { NEXTAUTH_PROVIDER: "email", BASE_HOST: "http://localhost:5560" },
}));

vi.mock("~/server/rateLimit", () => ({
  rateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));

vi.mock("@ee/audit-log/auditLog", () => ({
  auditLog: vi.fn().mockResolvedValue(void 0),
}));

const { secureAccountFacts, twoStepOffered } = vi.hoisted(() => ({
  secureAccountFacts: vi.fn(),
  twoStepOffered: vi.fn(),
}));

vi.mock("~/server/app-layer/identity/runtime", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("~/server/app-layer/identity/runtime")
  >()),
  credentialAccounts: () => ({ secureAccountFacts }),
}));

vi.mock("~/server/app-layer/identity/signin-method-policy", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("~/server/app-layer/identity/signin-method-policy")
  >()),
  deploymentOffersTwoStepVerification: () => twoStepOffered(),
}));

const NOW = new Date("2026-09-07T12:00:00.000Z");

const caller = () =>
  userRouter.createCaller(
    createInnerTRPCContext({
      session: {
        user: { id: "sam", email: "sam@example.com" },
        sessionId: "session-sam",
        signedInWith: "password",
        expires: "2099-01-01",
      },
    }),
  );

const facts = ({
  passkeys = 0,
  twoStepEnabled = false,
  nudgeDismissedAt = null,
}: {
  passkeys?: number;
  twoStepEnabled?: boolean;
  nudgeDismissedAt?: Date | null;
} = {}) => ({ passkeys, twoStepEnabled, nudgeDismissedAt });

describe("userRouter.secureAccountNudge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    twoStepOffered.mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** @scenario "The offer covers whichever of the two the person lacks" */
  it("offers both missing account protections as one decision", async () => {
    secureAccountFacts.mockResolvedValue(facts());

    await expect(caller().secureAccountNudge({})).resolves.toEqual({
      offer: true,
      passkey: true,
      twoStep: true,
      signedInWith: "password",
    });
  });

  /** @scenario "Each half disappears once the person has it" */
  it.each([
    {
      held: "passkey",
      account: facts({ passkeys: 1 }),
      expected: { passkey: false, twoStep: true },
    },
    {
      held: "two-step verification",
      account: facts({ twoStepEnabled: true }),
      expected: { passkey: true, twoStep: false },
    },
  ])("removes the $held half and leaves the other", async ({ account, expected }) => {
    secureAccountFacts.mockResolvedValue(account);

    await expect(caller().secureAccountNudge({})).resolves.toMatchObject({
      offer: true,
      ...expected,
    });
  });

  /** @scenario "Only what the deployment offers is offered" */
  it("keeps the permanent passkey offer when two-step setup is unavailable", async () => {
    twoStepOffered.mockReturnValue(false);
    secureAccountFacts.mockResolvedValue(facts());

    await expect(caller().secureAccountNudge({})).resolves.toMatchObject({
      offer: true,
      passkey: true,
      twoStep: false,
    });
  });

  /** @scenario "One dismissal answers the whole offer" */
  it("suppresses both halves until the shared interval has passed", async () => {
    secureAccountFacts.mockResolvedValue(facts({ nudgeDismissedAt: NOW }));

    await expect(caller().secureAccountNudge({})).resolves.toMatchObject({
      offer: false,
      passkey: true,
      twoStep: true,
    });

    vi.setSystemTime(new Date("2026-10-08T12:00:00.000Z"));
    await expect(caller().secureAccountNudge({})).resolves.toMatchObject({
      offer: true,
      passkey: true,
      twoStep: true,
    });
  });
});
