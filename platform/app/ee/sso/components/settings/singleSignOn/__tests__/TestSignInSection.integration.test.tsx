/**
 * @vitest-environment jsdom
 *
 * What the test sign-in step says before it is pressed (see
 * specs/identity/sso-activation.feature).
 *
 * The consequence an administrator cannot read their way out of afterwards
 * is being signed out of the session they are configuring the connection
 * with. What FOLLOWS a success was already handled well - somebody who comes
 * back as a different person lands on a page saying the test worked, naming
 * the address the session is now held as, and offering the way back - so
 * this is about the sentence before the button rather than the recovery
 * after it. "Brings you back here" on its own reads like a round trip that
 * returns you as yourself.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/features/errors/logic/presentation", () => ({
  explainAnyError: () => ({ title: "t", describe: () => "d" }),
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));

vi.mock("~/utils/auth-client", () => ({
  authClient: { signIn: { sso: vi.fn() } },
  useSession: () => ({ data: { user: { email: "ana@acme.com" } } }),
}));

import { TestSignInSection } from "../TestSignInSection";

function renderSection(overrides: { verifiedDomains?: string[] } = {}) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <TestSignInSection
        connectionId="ssoc_acme"
        providerName="Okta"
        canManage={true}
        testSignIn={{ done: false, atMs: null }}
        connectionState="VERIFIED"
        verifiedDomains={overrides.verifiedDomains ?? ["acme.com"]}
      />
    </ChakraProvider>,
  );
}

describe("given an administrator about to run a test sign-in", () => {
  afterEach(cleanup);

  describe("when they read the step", () => {
    /** @scenario "The test says it will replace this session before it is pressed" */
    it("says a success is a real sign-in that replaces this session", () => {
      renderSection();

      const note = screen.getByTestId("test-sign-in-session-note");
      expect(note.textContent).toContain("real sign-in");
      expect(note.textContent).toContain("replaces the session");
    });

    /** @scenario "The test says it will replace this session before it is pressed" */
    it("says they come back as whoever the provider signs them in as", () => {
      renderSection();

      expect(
        screen.getByTestId("test-sign-in-session-note").textContent,
      ).toContain("somebody other than yourself");
    });

    /** @scenario "The test says it will replace this session before it is pressed" */
    it("says the way back to their own account is offered", () => {
      renderSection();

      // Without this the sentence is a warning with no exit, which reads
      // worse than the surprise it replaces: the recovery page genuinely
      // exists, so saying so is both true and the reassuring half.
      expect(
        screen.getByTestId("test-sign-in-session-note").textContent,
      ).toContain("way back to your own account");
    });

    /** @scenario "The test says it will replace this session before it is pressed" */
    it("says it before the control rather than after it", () => {
      const { container } = renderSection();

      // Position, not presence. A consequence disclosed underneath the
      // button is disclosed to somebody who has already pressed it.
      const text = container.textContent ?? "";
      expect(text.indexOf("replaces the session")).toBeGreaterThanOrEqual(0);
      expect(text.indexOf("replaces the session")).toBeLessThan(
        text.indexOf("Test sign-in"),
      );
    });
  });
});
