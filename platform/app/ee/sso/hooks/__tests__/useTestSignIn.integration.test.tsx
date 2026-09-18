/**
 * @vitest-environment jsdom
 *
 * What an administrator is told when their own test sign-in comes back
 * refused (specs/identity/sso-assertion-refusals.feature).
 *
 * THE BUG THIS PINS. Our own refusals arrive through the same `?error=` the
 * identity provider's failures use, and this screen reported every one of them
 * as "your identity provider sent you back with an error", quoting our code
 * back as though the provider had said it. An administrator reading that goes
 * off to debug a provider that is configured perfectly.
 *
 * The same codes render differently on the public sign-in error screen, which
 * has a reader who usually cannot fix any of it. That is the point: one code,
 * two audiences, and no second piece of server state to keep in step.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** The address on the reader's own LangWatch account, which the remedy names. */
const YOUR_ADDRESS = "ana@acme.com";

vi.mock("~/utils/auth-client", () => ({
  authClient: { signIn: { sso: vi.fn() } },
  useSession: () => ({ data: { user: { email: YOUR_ADDRESS } } }),
}));

const { useTestSignIn } = await import("../useTestSignIn");
const notices = await import("../../components/TestSignInFailureNotice");
const { TestSignInFailureNotice } = notices;

const CONNECTION_ID = "ssoc_selfserve_0787f02a11a49958cc2b4672";

/** The settings page an administrator lands back on, as the provider left it. */
function landOn({
  error,
  description,
  marker = CONNECTION_ID,
}: {
  error: string;
  description?: string;
  marker?: string;
}) {
  const params = new URLSearchParams({ error, ssoTest: marker });
  if (description) params.set("error_description", description);
  window.history.replaceState(
    {},
    "",
    `/settings/authentication?${params.toString()}`,
  );
}

/** The section as it draws the verdict it came back with. */
function Harness() {
  const { failure } = useTestSignIn({ connectionId: CONNECTION_ID });
  if (!failure) return <div data-testid="no-failure" />;
  return <TestSignInFailureNotice failure={failure} />;
}

const draw = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <Harness />
    </ChakraProvider>,
  );

afterEach(() => cleanup());

describe("given a test sign-in our own gate refused", () => {
  /** @scenario "A SAML account-link refusal is explained as a local sign-in failure" */
  it.each([
    "account_not_linked",
    "account not linked",
    "OAuthAccountNotLinked",
  ])("explains %s without blaming the provider", (error) => {
    landOn({ error });
    draw();

    expect(
      screen.getByText("LangWatch couldn't link that sign-in to your account"),
    ).toBeTruthy();
    expect(
      screen.getByText(/address verified on your LangWatch account/),
    ).toBeTruthy();
    expect(screen.queryByTestId("test-sign-in-failure-detail")).toBeNull();
    expect(screen.queryByText(/provider sent you back/)).toBeNull();
  });

  beforeEach(() => {
    landOn({ error: "sso_setup_address_mismatch" });
  });

  describe("when the administrator is returned to the settings screen", () => {
    /** @scenario "A test sign-in explains itself on the settings screen" */
    it("names the cause as the address, not the connection's state", () => {
      draw();

      // "Still being set up" tells the one person who is supposed to act that
      // they may not — while they are doing the very step setup asked them
      // for. The cause is narrower and fixable: the provider sent a different
      // address than the one on the account that registered the connection.
      expect(
        screen.getByText(/signed you in as a different address/i),
      ).toBeTruthy();
      expect(screen.queryByText(/still being set up/i)).toBeNull();
    });

    /** @scenario "The administrator is told the ways out of an address mismatch" */
    it("offers all three ways out, and names their own address", () => {
      draw();

      const words =
        screen.getByTestId("test-sign-in-failure").textContent ?? "";

      // Their own address, so they can compare it against what their provider
      // is actually asserting.
      expect(words).toContain(YOUR_ADDRESS);
      // Sign in at the provider as that address...
      expect(words).toMatch(
        /sign in at your identity provider as that address/i,
      );
      // ...or make the provider's address one of theirs, which is the way
      // through when a work identity is not the address their LangWatch
      // account was opened with...
      expect(words).toMatch(/add the address your provider does use/i);
      // ...or verify the domain, which opens it to everybody on it.
      expect(words).toMatch(/verifying the domain/i);
    });

    it("does not blame the identity provider for our refusal", () => {
      draw();

      expect(screen.queryByText(/sent you back with an error/i)).toBeNull();
      // And our code is not quoted at them as if it were a provider's words.
      expect(screen.queryByTestId("test-sign-in-failure-detail")).toBeNull();
    });
  });
});

describe("given a test sign-in the identity provider itself rejected", () => {
  beforeEach(() => {
    landOn({
      error: "invalid_client",
      description: "The client credentials are invalid",
    });
  });

  describe("when the administrator is returned to the settings screen", () => {
    /** @scenario "A provider's own error is still quoted verbatim" */
    it("shows the provider's words unchanged", () => {
      draw();

      expect(screen.getByText(/sent you back with an error/i)).toBeTruthy();
      // Quoted rather than summarised: there is no code of ours to key copy
      // off, so the sentence somebody else's server wrote is the one thing
      // the administrator can actually work from.
      expect(
        screen.getByTestId("test-sign-in-failure-detail").textContent,
      ).toContain("The client credentials are invalid");
    });
  });
});

describe("given an error on the page that belongs to some other flow", () => {
  describe("when the section reads the address", () => {
    it("reports nothing, because it is not this test's verdict", () => {
      // `error`/`error_description` is the shape every OAuth bounce uses, and
      // this hook sits on ordinary app routes other flows land on.
      landOn({ error: "sso_setup_address_mismatch", marker: "some-other" });

      draw();

      expect(screen.getByTestId("no-failure")).toBeTruthy();
    });
  });
});
