/**
 * @vitest-environment jsdom
 *
 * Covers specs/auth/sign-in-failure-messages.feature.
 *
 * The real sign-in screen, the real form, the real auth client and the real
 * wording rules all run here. Only the network is replaced: `fetch` answers the
 * way the server answers, so a failure travels the whole path it travels in a
 * browser, from the HTTP body to the sentence on screen.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Installed before any import evaluates: the BetterAuth client captures a fetch
// implementation when `~/utils/auth-client` first loads, so a stub installed
// later in the test body would never be the one it calls.
const { fetchMock, sessionRef, publicEnvRef, searchParamsRef } = vi.hoisted(
  () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    return {
      fetchMock,
      sessionRef: { current: { data: null as unknown } },
      publicEnvRef: {
        current: { NEXTAUTH_PROVIDER: "email" as string | undefined },
      },
      searchParamsRef: { current: new URLSearchParams("") },
    };
  },
);

// The session hook polls a live endpoint on mount; the screen under test is the
// signed-out one. Everything below it, `signIn` included, stays real.
vi.mock("~/utils/auth-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/utils/auth-client")>();
  return { ...actual, useSession: () => sessionRef.current };
});

vi.mock("~/utils/compat/next-navigation", () => ({
  useSearchParams: () => searchParamsRef.current,
}));

vi.mock("~/hooks/usePublicEnv", () => ({
  usePublicEnv: () => ({ data: publicEnvRef.current }),
}));

vi.mock("~/utils/compat/next-link", () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import SignIn from "../signin";

/** What the server puts on the wire for the sign-in call. */
const serverAnswers = (status: number, body: Record<string, unknown>) => {
  fetchMock.mockImplementation(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
  );
};

const submitSignIn = async () => {
  const user = userEvent.setup();
  const { container } = render(
    <ChakraProvider value={defaultSystem}>
      <SignIn />
    </ChakraProvider>,
  );

  await user.type(
    container.querySelector('input[type="email"]')!,
    "someone@example.com",
  );
  await user.type(
    container.querySelector('input[type="password"]')!,
    "whatever12345",
  );
  await user.click(screen.getByRole("button", { name: /sign in/i }));

  return container;
};

/** The wording the screen settles on, read off the rendered form. */
const failureMessage = async (container: HTMLElement) => {
  const alert = await waitFor(() => {
    const found = container.querySelector(".chakra-alert__root");
    expect(found?.textContent?.trim()).toBeTruthy();
    return found!;
  });
  return alert.textContent!;
};

describe("given the sign-in screen of a credentials installation", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    sessionRef.current = { data: null };
    publicEnvRef.current = { NEXTAUTH_PROVIDER: "email" };
    searchParamsRef.current = new URLSearchParams("");
  });

  afterEach(() => {
    cleanup();
  });

  describe("when the password is wrong", () => {
    /** @scenario A wrong password says the password is wrong */
    it("says the email or password is wrong, next to the form", async () => {
      serverAnswers(401, {
        message: "Invalid email or password",
        code: "INVALID_EMAIL_OR_PASSWORD",
      });

      const container = await submitSignIn();

      expect(await failureMessage(container)).toMatch(
        /invalid email or password/i,
      );
    });
  });

  describe("when the installation is set up for another address", () => {
    /** @scenario An address mismatch says which thing to check */
    it("names the address as the thing to check", async () => {
      serverAnswers(403, { message: "Invalid origin", code: "INVALID_ORIGIN" });

      const container = await submitSignIn();

      expect(await failureMessage(container)).toMatch(
        /set up for a different web address[\s\S]*check the address/i,
      );
    });

    it("never puts the internal code on screen", async () => {
      serverAnswers(403, { message: "Invalid origin", code: "INVALID_ORIGIN" });

      const container = await submitSignIn();
      const message = await failureMessage(container);

      expect(message).not.toMatch(/INVALID_ORIGIN/);
      expect(message).not.toMatch(/origin/i);
    });

    it("does not fall back to the message that says nothing", async () => {
      serverAnswers(403, { message: "Invalid origin", code: "INVALID_ORIGIN" });

      const container = await submitSignIn();

      expect(await failureMessage(container)).not.toMatch(/failed to sign in/i);
    });
  });

  describe("when too many attempts have been made", () => {
    /** @scenario Too many attempts says to wait */
    it("says to wait before trying again", async () => {
      serverAnswers(429, { message: "Too many requests" });

      const container = await submitSignIn();

      expect(await failureMessage(container)).toMatch(/wait a minute/i);
    });
  });

  describe("when the failure has no wording of its own", () => {
    /** @scenario An unexpected failure still says something honest */
    it("says the sign-in did not go through, without the code", async () => {
      serverAnswers(400, { code: "SOMETHING_WE_HAVE_NOT_SEEN" });

      const container = await submitSignIn();
      const message = await failureMessage(container);

      expect(message).toMatch(/did not go through/i);
      expect(message).not.toMatch(/SOMETHING_WE_HAVE_NOT_SEEN/);
    });
  });

  describe("when nothing has been submitted yet", () => {
    it("shows no failure message", () => {
      const { container } = render(
        <ChakraProvider value={defaultSystem}>
          <SignIn />
        </ChakraProvider>,
      );

      expect(container.querySelector(".chakra-alert__root")).toBeNull();
    });
  });
});
