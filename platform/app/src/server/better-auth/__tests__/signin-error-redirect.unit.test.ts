/**
 * @vitest-environment node
 *
 * What a failed single sign-on is allowed to say in the address bar.
 *
 * Corresponds to specs/identity/sso-signin-error-boundary.feature.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { errorLog } = vi.hoisted(() => ({ errorLog: vi.fn() }));

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    error: errorLog,
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { withholdInternalSignInError } from "../signin-error-redirect";

const ERROR_PAGE = "https://app.langwatch.test/auth/error";

/** The answer better-auth gives a failed sign-in: a redirect, not a body. */
function redirectCarrying({
  error,
  description,
  extra = {},
}: {
  error: string;
  description?: string;
  extra?: Record<string, string>;
}): Response {
  const location = new URL(ERROR_PAGE);
  location.searchParams.set("error", error);
  if (description !== undefined) {
    location.searchParams.set("error_description", description);
  }
  for (const [key, value] of Object.entries(extra)) {
    location.searchParams.set(key, value);
  }
  return new Response(null, {
    status: 302,
    headers: { location: location.toString() },
  });
}

const locationOf = (response: Response) =>
  new URL(response.headers.get("location") ?? "");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("given a sign-in refused with a handled error", () => {
  describe("when the person is redirected to the sign-in error screen", () => {
    /** @scenario "A handled refusal crosses with its own code" */
    it("carries that refusal's own stable code through untouched", () => {
      // The refusals somebody can act on — the wrong provider for their
      // domain, an organization that requires single sign-on, a link needing
      // approval. Losing them to a generic code would make every failure look
      // the same and strand people the screen could have helped.
      for (const code of [
        "SSO_PROVIDER_NOT_ALLOWED",
        "LINK_NEEDS_APPROVAL",
        "sso_domain_not_verified",
        "OAuthAccountNotLinked",
        // An alias the screen normalises into a code it has words for is a
        // code it has words for, so it crosses too.
        "email_doesn't_match",
      ]) {
        const answered = withholdInternalSignInError({
          response: redirectCarrying({ error: code }),
          errorPageUrl: ERROR_PAGE,
          traceId: "trace_1",
        });

        expect(locationOf(answered).searchParams.get("error")).toBe(code);
      }
      // Nothing was withheld, so nothing was logged as withheld.
      expect(errorLog).not.toHaveBeenCalled();
    });

    it("keeps the description on the one refusal whose description is the way out", () => {
      // `SSO_REQUIRED_BY_ORGANIZATION` carries the connection to bounce to as
      // its description — the page spends it by dialling that connection. A
      // boundary that stripped every description would turn the product's
      // smoothest recovery into a dead end.
      const answered = withholdInternalSignInError({
        response: redirectCarrying({
          error: "SSO_REQUIRED_BY_ORGANIZATION",
          description: "ssoc_acme",
        }),
        errorPageUrl: ERROR_PAGE,
        traceId: "trace_1",
      });

      expect(locationOf(answered).searchParams.get("error_description")).toBe(
        "ssoc_acme",
      );
    });
  });
});

describe("given a sign-in that failed for a reason we have not written down", () => {
  describe("when the person is redirected to the sign-in error screen", () => {
    /** @scenario "An unhandled failure crosses as one generic code" */
    it("carries a single generic code and no description of the internal failure", () => {
      const answered = withholdInternalSignInError({
        response: redirectCarrying({
          error: "SOME_INTERNAL_STATE_WE_DID_NOT_ANTICIPATE",
          description: "the widget pool was exhausted",
        }),
        errorPageUrl: ERROR_PAGE,
        traceId: "trace_1",
      });

      const location = locationOf(answered);
      expect(location.searchParams.get("error")).toBe("sign_in_failed");
      expect(location.searchParams.get("error_description")).toBeNull();
      // Not merely renamed — the internal words are nowhere in the address.
      expect(location.toString()).not.toContain("widget pool");
    });

    it("keeps the redirect a redirect, and keeps where they were going", () => {
      const answered = withholdInternalSignInError({
        response: redirectCarrying({
          error: "SOMETHING_INTERNAL",
          extra: { callbackUrl: "/settings/authentication" },
        }),
        errorPageUrl: ERROR_PAGE,
        traceId: null,
      });

      expect(answered.status).toBe(302);
      // The recovery button reads this to send them back where they meant to
      // go, so withholding the reason must not also lose the destination.
      expect(locationOf(answered).searchParams.get("callbackUrl")).toBe(
        "/settings/authentication",
      );
      // With no trace id there is no reference to show, and an empty one is
      // worse than none — it reads as a reference support cannot find.
      expect(locationOf(answered).searchParams.has("trace")).toBe(false);
    });

    /** @scenario "The cause is written down where we can read it" */
    it("logs the real cause with the trace id the screen can show", () => {
      const answered = withholdInternalSignInError({
        response: redirectCarrying({
          error: "SSO_USER_RESOLUTION_REQUIRES_NATIVE_TRANSACTIONS",
          description:
            "SSO user resolution requires a database adapter with native transaction support",
        }),
        errorPageUrl: ERROR_PAGE,
        traceId: "trace_abc123",
      });

      // THE HALF THAT WAS MISSING ENTIRELY: this failure produced no server
      // log line at all, so the one copy of the cause was in somebody's
      // address bar.
      expect(errorLog).toHaveBeenCalledTimes(1);
      const [logged] = errorLog.mock.calls[0] as [Record<string, unknown>];
      expect(logged.code).toBe(
        "SSO_USER_RESOLUTION_REQUIRES_NATIVE_TRANSACTIONS",
      );
      expect(logged.description).toContain("native transaction support");
      expect(logged.traceId).toBe("trace_abc123");

      // And the id on the screen is the id in the log — one handle, or the
      // reference is useless to whoever is asked to look it up.
      expect(locationOf(answered).searchParams.get("trace")).toBe(
        "trace_abc123",
      );
    });

    /** @scenario "An internal code never travels" */
    it("never lets the plugin's native-transaction error into the address", () => {
      const answered = withholdInternalSignInError({
        response: redirectCarrying({
          error: "SSO_USER_RESOLUTION_REQUIRES_NATIVE_TRANSACTIONS",
          description:
            "SSO user resolution requires a database adapter with native transaction support",
        }),
        errorPageUrl: ERROR_PAGE,
        traceId: "trace_1",
      });

      // The concrete failure this whole boundary was written for.
      const address = locationOf(answered).toString();
      expect(address).not.toContain(
        "SSO_USER_RESOLUTION_REQUIRES_NATIVE_TRANSACTIONS",
      );
      // And not merely that one string: the address names no part of how the
      // product is built.
      expect(address).not.toMatch(/database|adapter|transaction|capability/i);
    });
  });
});

describe("given an answer that is not a failed sign-in", () => {
  it("leaves every other response exactly as it was", () => {
    // A successful callback carrying somebody onward to the application.
    const onward = new Response(null, {
      status: 302,
      headers: { location: "https://app.langwatch.test/settings?welcome=1" },
    });
    expect(
      withholdInternalSignInError({
        response: onward,
        errorPageUrl: ERROR_PAGE,
        traceId: "trace_1",
      }),
    ).toBe(onward);

    // A body, not a redirect — that is the other boundary's business.
    const body = new Response("{}", { status: 400 });
    expect(
      withholdInternalSignInError({
        response: body,
        errorPageUrl: ERROR_PAGE,
        traceId: "trace_1",
      }),
    ).toBe(body);

    // The error page reached with no error on it at all.
    const bare = new Response(null, {
      status: 302,
      headers: { location: ERROR_PAGE },
    });
    expect(
      withholdInternalSignInError({
        response: bare,
        errorPageUrl: ERROR_PAGE,
        traceId: "trace_1",
      }),
    ).toBe(bare);

    expect(errorLog).not.toHaveBeenCalled();
  });
});
