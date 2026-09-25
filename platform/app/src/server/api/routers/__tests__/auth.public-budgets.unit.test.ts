/**
 * @vitest-environment node
 *
 * The budgets the signed-out auth surface spends, exhausted for real.
 *
 * `auth.rate-limit-client.unit.test.ts` next door proves each budget is keyed
 * on the trusted-proxy-aware caller. This one proves the budgets RUN OUT: it
 * drives the procedures past their windows through the in-memory limiter (no
 * App is composed here, so `rateLimit` falls back to process memory) and
 * watches the refusal arrive and the work behind it stop.
 *
 * Both procedures carry two budgets, for two different abuses:
 *
 *   - `auth.route` answers whether an address has an account, so a caller
 *     walking a list is the enumeration risk and one address probed from
 *     everywhere is the harassment risk.
 *   - `auth.requestSignUpVerification` SENDS MAIL to an address nobody has
 *     proved they hold, so the second budget is what stops a stranger's
 *     half-finished sign-up becoming a way to mail them over and over.
 *
 * Specs: specs/identity/signin-router.feature, specs/auth/rate-limiting.feature
 */
import { IncomingMessage } from "node:http";
import { Socket } from "node:net";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { _resetMemoryRateLimitStore } from "~/server/rateLimit";
import type { NextApiRequest } from "~/types/next-stubs";
import { createInnerTRPCContext } from "../../trpc";
import { authRouter } from "../auth";

const { route, addressState, requestVerification } = vi.hoisted(() => ({
  route: vi.fn(),
  addressState: vi.fn(),
  requestVerification: vi.fn(),
}));

vi.mock("~/server/app-layer/identity/runtime", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("~/server/app-layer/identity/runtime")
  >()),
  signInRouter: () => ({ route }),
  signUpVerification: () => ({ addressState, requestVerification }),
}));

// These budgets guard the mailing path, which runs only where an email
// provider is configured.
vi.mock("~/server/mailer/providers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/server/mailer/providers")>()),
  hasEmailProvider: () => true,
}));

/**
 * A request whose socket peer is the address the budget is keyed on.
 *
 * The same shape the Hono-to-tRPC shim builds for a real call — an
 * `IncomingMessage` with the peer pinned on its socket — so the trusted-proxy
 * resolver reads it exactly as it reads production traffic. Public addresses
 * from TEST-NET-3, which the resolver treats as callers rather than as the
 * deployment's own hops.
 */
function requestFrom(peerIp: string): NextApiRequest {
  const incoming = new IncomingMessage(new Socket());
  incoming.headers = {};
  incoming.method = "POST";
  incoming.url = "/api/trpc/auth.route";
  Object.defineProperty(incoming.socket, "remoteAddress", {
    configurable: true,
    value: peerIp,
  });
  return Object.assign(incoming, { query: {}, cookies: {}, env: {} });
}

function callerFrom(peerIp: string) {
  return authRouter.createCaller(
    createInnerTRPCContext({ session: null, req: requestFrom(peerIp) }),
  );
}

/** `203.0.113.0/24` is TEST-NET-3: routable-looking, allocated to nobody. */
function nthCaller(n: number) {
  return callerFrom(`203.0.113.${n % 256}`);
}

const rateLimited = {
  code: "TOO_MANY_REQUESTS",
  cause: { code: "auth_rate_limited" },
};

describe("the signed-out auth surface's budgets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Both budgets live in process memory when there is no Redis, which is
    // every unit run — one case's spending would otherwise be the next
    // case's starting point.
    _resetMemoryRateLimitStore();
    route.mockResolvedValue({
      outcome: "sign_up",
      methodSet: [],
      reasonCode: "identifier_unknown",
    });
    addressState.mockResolvedValue("pending");
    requestVerification.mockResolvedValue(void 0);
  });

  describe("given somebody asking the sign-in router where addresses should go", () => {
    describe("when one caller asks about address after address", () => {
      /** @scenario "Asking about address after address from one place is eventually refused" */
      it("refuses once the caller's hour is spent, without consulting the router", async () => {
        const caller = callerFrom("203.0.113.7");
        for (let asked = 0; asked < 60; asked++) {
          await caller.route({ identifier: `person-${asked}@example.com` });
        }
        expect(route).toHaveBeenCalledTimes(60);

        await expect(
          caller.route({ identifier: "person-60@example.com" }),
        ).rejects.toMatchObject(rateLimited);

        expect(route).toHaveBeenCalledTimes(60);
      });

      /** @scenario "Asking about address after address from one place is eventually refused" */
      it("tells the refused caller how long to wait", async () => {
        const caller = callerFrom("203.0.113.8");
        for (let asked = 0; asked < 60; asked++) {
          await caller.route({ identifier: `person-${asked}@example.com` });
        }

        const refusal = await caller
          .route({ identifier: "person-60@example.com" })
          .then(
            () => null,
            (error: unknown) => error,
          );

        expect(refusal).toMatchObject({
          cause: {
            code: "auth_rate_limited",
            meta: { retryAfterSeconds: expect.any(Number) },
          },
        });
      });
    });

    describe("when one address is asked about from a new client each time", () => {
      /** @scenario "One address probed from many places is eventually refused" */
      it("refuses the address once its hour is spent, whoever is asking", async () => {
        const hounded = "sam@example.com";
        for (let client = 1; client <= 30; client++) {
          await nthCaller(client).route({ identifier: hounded });
        }
        expect(route).toHaveBeenCalledTimes(30);

        await expect(
          nthCaller(31).route({ identifier: hounded }),
        ).rejects.toMatchObject(rateLimited);
        expect(route).toHaveBeenCalledTimes(30);

        // The client that was just refused has spent one question of its own
        // budget, so its own sign-in still works: the address ran out, not
        // the person who happened to ask last.
        await expect(
          nthCaller(31).route({ identifier: "someone-else@example.com" }),
        ).resolves.toMatchObject({ reasonCode: "identifier_unknown" });
      });
    });
  });

  describe("given an address on an SSO domain", () => {
    const decisions = [
      {
        reasonCode: "domain_routed",
        outcome: "redirect_to_connection",
      },
      { reasonCode: "connection_suspended", outcome: "method_picker" },
      {
        reasonCode: "method_not_licensed",
        outcome: "method_picker",
        domainManaged: true,
      },
      {
        reasonCode: "method_not_configured",
        outcome: "method_picker",
        domainManaged: true,
      },
    ];

    /** @scenario "Sign-up never reveals account existence on an SSO domain" */
    /** @scenario "Sign-up never reveals account existence when managed SSO cannot route" */
    it.each(decisions)("hides account existence for $reasonCode", async ({
      reasonCode,
      outcome,
      domainManaged,
    }) => {
      route.mockResolvedValue({
        outcome,
        methodSet: [],
        reasonCode,
        ...(domainManaged ? { domainManaged } : {}),
      });
      const caller = callerFrom("203.0.113.88");
      for (const state of ["confirmed", "pending", "unknown"]) {
        addressState.mockResolvedValue(state);
        await expect(
          caller.requestSignUpVerification({ email: "someone@acme.com" }),
        ).rejects.toMatchObject({
          code: "BAD_REQUEST",
          cause: {
            code: "auth_direct_registration_unavailable",
            message: expect.stringContaining("identity provider"),
          },
        });
      }
      expect(addressState).not.toHaveBeenCalled();
      expect(requestVerification).not.toHaveBeenCalled();
    });

    /** @scenario "Sign-up still guides an existing account outside SSO domains" */
    it("preserves the existing-account response outside SSO domains", async () => {
      addressState.mockResolvedValue("confirmed");
      await expect(
        callerFrom("203.0.113.89").requestSignUpVerification({
          email: "someone@example.com",
        }),
      ).rejects.toMatchObject({ cause: { code: "email_already_registered" } });
      expect(addressState).toHaveBeenCalledWith({
        email: "someone@example.com",
      });
      expect(requestVerification).not.toHaveBeenCalled();
    });
  });

  describe("given somebody asking for a sign-up confirmation link", () => {
    describe("when one caller asks again and again", () => {
      /** @scenario "Asking again and again for a confirmation link stops being answered" */
      it("stops answering once the caller's hour is spent, and stops mailing", async () => {
        const caller = callerFrom("203.0.113.90");
        for (let asked = 0; asked < 20; asked++) {
          await caller.requestSignUpVerification({
            email: `person-${asked}@example.com`,
          });
        }
        expect(requestVerification).toHaveBeenCalledTimes(20);

        await expect(
          caller.requestSignUpVerification({ email: "person-20@example.com" }),
        ).rejects.toMatchObject(rateLimited);

        expect(requestVerification).toHaveBeenCalledTimes(20);
      });
    });

    describe("when the same address is asked for from a new client each time", () => {
      /** @scenario "A stranger's address cannot be mail-bombed through sign-up" */
      it("stops mailing that address however many callers ask", async () => {
        const hounded = "stranger@example.com";
        for (let client = 100; client < 105; client++) {
          await callerFrom(`203.0.113.${client}`).requestSignUpVerification({
            email: hounded,
          });
        }
        expect(requestVerification).toHaveBeenCalledTimes(5);

        await expect(
          callerFrom("203.0.113.105").requestSignUpVerification({
            email: hounded,
          }),
        ).rejects.toMatchObject(rateLimited);

        // The mail that matters is the sixth one, and it was never attempted:
        // the budget refused before the service that sends it was reached.
        expect(requestVerification).toHaveBeenCalledTimes(5);
      });
    });
  });
});
