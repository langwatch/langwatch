/**
 * @vitest-environment jsdom
 *
 * The sign-in error card: what it is willing to say, and what it refuses to
 * repeat back.
 *
 * Corresponds to specs/identity/sso-signin-error-boundary.feature. The
 * BOUNDARY that decides which codes reach this screen at all is tested in
 * `server/better-auth/__tests__/signin-error-redirect.unit.test.ts`; this is
 * the other end of the same rule.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { searchParamsRef } = vi.hoisted(() => ({
  searchParamsRef: { current: new URLSearchParams("") },
}));

vi.mock("~/utils/compat/next-navigation", () => ({
  useSearchParams: () => searchParamsRef.current,
  usePathname: () => "/auth/error",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("~/utils/auth-client", () => ({
  signIn: vi.fn(),
  useSession: () => ({ data: null }),
  isSameOrigin: () => false,
}));

vi.mock("~/utils/api", () => ({
  api: {
    publicEnv: { useQuery: () => ({ data: undefined }) },
  },
}));

const { SignInError } = await import("../error");

const draw = (error: string) =>
  render(
    <ChakraProvider value={defaultSystem}>
      <SignInError error={error} />
    </ChakraProvider>,
  );

beforeEach(() => {
  searchParamsRef.current = new URLSearchParams("");
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("given somebody opens the sign-in error screen with a description of their own", () => {
  describe("when the screen renders", () => {
    /** @scenario "A description supplied by the caller is never echoed" */
    it("does not show the supplied description", () => {
      // `?error_description=` is as caller-controlled as `?error=`, and the
      // screen already refuses to echo the second. Echoing the first would
      // put attacker-chosen prose under LangWatch branding just the same.
      const planted =
        "Your account was suspended. Call +1-555-0100 to restore it.";
      searchParamsRef.current = new URLSearchParams({
        error: "sign_in_failed",
        error_description: planted,
      });

      draw("sign_in_failed");

      expect(screen.queryByText(planted)).toBeNull();
      expect(document.body.textContent).not.toContain("555-0100");
      // The words that DO show are ours, and they are the generic ones.
      // `getAllBy`, because the card says it twice on purpose — once as the
      // heading and once as the sentence under it.
      expect(
        screen.getAllByText(/Something went wrong signing you in/i).length,
      ).toBeGreaterThan(0);
    });

    it("does not echo a caller-supplied code either", () => {
      const planted = "ACCOUNT_SEIZED_CONTACT_SUPPORT_IMMEDIATELY";
      searchParamsRef.current = new URLSearchParams({ error: planted });

      draw(planted);

      expect(document.body.textContent).not.toContain(planted);
      expect(
        screen.getAllByText(/Something went wrong signing you in/i).length,
      ).toBeGreaterThan(0);
    });
  });
});

describe("given a refusal that crossed with its own code", () => {
  /** @scenario "A handled refusal crosses with its own code" */
  it("renders the copy written for it rather than the generic line", () => {
    searchParamsRef.current = new URLSearchParams({
      error: "LINK_NEEDS_APPROVAL",
    });

    draw("LINK_NEEDS_APPROVAL");

    // The half of the scenario that lives on this screen: a code that is
    // allowed to travel is one somebody wrote words for, and this is those
    // words.
    expect(
      screen.getByText(/An administrator in your organization can review/i),
    ).toBeInTheDocument();
    expect(
      screen.queryAllByText(/Something went wrong signing you in/i),
    ).toHaveLength(0);
  });
});

describe("given a failure whose cause was withheld", () => {
  /** @scenario "The cause is written down where we can read it" */
  it("shows the trace id so the person can quote what the log recorded", () => {
    searchParamsRef.current = new URLSearchParams({
      error: "sign_in_failed",
      trace: "trace_abc123",
    });

    draw("sign_in_failed");

    // The reason is deliberately not on screen, so this reference is the only
    // thing tying what they are looking at to the line we wrote.
    expect(screen.getByTestId("sign-in-error-trace").textContent).toContain(
      "trace_abc123",
    );
  });

  it("shows no reference when there is none to show", () => {
    searchParamsRef.current = new URLSearchParams({ error: "sign_in_failed" });

    draw("sign_in_failed");

    expect(screen.queryByTestId("sign-in-error-trace")).toBeNull();
  });
});

describe("given one of the assertion refusals the boundary admits", () => {
  /** @scenario "A handled refusal crosses with its own code" */
  it("renders the words the registry already held for it, not the generic line", () => {
    // These five cross the redirect boundary on the grounds that a screen has
    // words for them. The words existed in the presentation registry the
    // whole time; this page never read them, so every one of them showed as
    // "Something went wrong signing you in" — a named, actionable,
    // customer-safe refusal presented as an unknown failure.
    searchParamsRef.current = new URLSearchParams({
      error: "sso_setup_address_mismatch",
    });

    draw("sso_setup_address_mismatch");

    expect(
      screen.getByText(
        /That address can't sign in through this connection yet/i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryAllByText(/Something went wrong signing you in/i),
    ).toHaveLength(0);
  });

  it("gives every admitted assertion refusal its own words", () => {
    for (const code of [
      "sso_sign_in_refused",
      "sso_assertion_without_address",
      "sso_domain_not_verified",
      "sso_domain_proof_lapsed",
    ]) {
      cleanup();
      searchParamsRef.current = new URLSearchParams({ error: code });
      draw(code);
      expect(
        screen.queryAllByText(/Something went wrong signing you in/i),
        `${code} still fell through to the generic arm`,
      ).toHaveLength(0);
    }
  });

  it("still refuses a code the boundary would not admit, however well known", () => {
    // The gate is the ADMITTED set, not the registry: `?error=` is
    // caller-controlled, so a code nobody would ever be redirected with must
    // not be able to pull one of our sentences under a LangWatch heading.
    searchParamsRef.current = new URLSearchParams({
      error: "validation_error",
    });

    draw("validation_error");

    expect(
      screen.getAllByText(/Something went wrong signing you in/i).length,
    ).toBeGreaterThan(0);
  });
});
