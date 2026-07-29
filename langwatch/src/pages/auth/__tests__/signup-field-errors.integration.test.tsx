/**
 * @vitest-environment jsdom
 *
 * Sign-up says why it refused, on the field it refused.
 *
 * A live UX pass found this form drawing a red outline around Confirm Password
 * and no words anywhere on the page. The rejection was correct and the sentence
 * existed — the zod schema's refine produces "Passwords don't match" on
 * `confirmPassword` — but every control was wired with `invalid` only, so
 * `HorizontalFormControl` had a boolean and never the message. Four fields, and
 * the same for all of them: "Name is required" and "Password must be at least 8
 * characters" were computed and thrown away too.
 *
 * Rendered rather than asserted on the schema on purpose: the schema was never
 * the broken half, and a test that drives it directly would have passed
 * throughout.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { sessionRef, publicEnvRef, searchParamsRef, mutateMock } = vi.hoisted(
  () => ({
    sessionRef: { current: { data: null as unknown } },
    publicEnvRef: {
      current: { NEXTAUTH_PROVIDER: "email" as string | undefined },
    },
    searchParamsRef: { current: new URLSearchParams("") },
    mutateMock: vi.fn(() => Promise.resolve({})),
  }),
);

vi.mock("~/utils/auth-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/utils/auth-client")>();
  return { ...actual, signIn: vi.fn(), useSession: () => sessionRef.current };
});

vi.mock("~/utils/compat/next-navigation", () => ({
  useSearchParams: () => searchParamsRef.current,
}));

vi.mock("~/hooks/usePublicEnv", () => ({
  usePublicEnv: () => ({ data: publicEnvRef.current }),
}));

vi.mock("~/utils/compat/next-link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("../../../utils/api", () => ({
  api: {
    user: {
      register: {
        useMutation: () => ({
          mutateAsync: mutateMock,
          error: null,
          isLoading: false,
        }),
      },
    },
  },
}));

import SignUp from "../signup";

const renderPage = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <SignUp />
    </ChakraProvider>,
  );

const fill = (container: HTMLElement, name: string, value: string) => {
  const input = container.querySelector<HTMLInputElement>(`[name="${name}"]`);
  if (!input) throw new Error(`no field named ${name}`);
  fireEvent.change(input, { target: { value } });
};

const submit = (container: HTMLElement) => {
  const form = container.querySelector("form");
  if (!form) throw new Error("no form");
  fireEvent.submit(form);
};

describe("SignUp field errors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionRef.current = { data: null };
    publicEnvRef.current = { NEXTAUTH_PROVIDER: "email" };
    searchParamsRef.current = new URLSearchParams("");
  });

  afterEach(() => cleanup());

  describe("when the confirmation does not match the password", () => {
    /** @scenario "Mismatched passwords say so" */
    it("says the passwords don't match", async () => {
      const { container } = renderPage();

      fill(container, "name", "UX Review");
      fill(container, "email", "ux.review@example.com");
      fill(container, "password", "SuperSecret123!");
      fill(container, "confirmPassword", "DifferentPassword123!");
      submit(container);

      await waitFor(() => {
        expect(screen.getByText(/passwords don't match/i)).toBeTruthy();
      });
      expect(mutateMock).not.toHaveBeenCalled();
    });
  });

  /**
   * The same wiring carries every other field's message, so one of them stands
   * in for the rest: it is one `error` prop per control, and it was missing on
   * all four.
   */
  describe("when a required field is left empty", () => {
    /** @scenario "A missing name says so" */
    it("says the name is required", async () => {
      const { container } = renderPage();

      fill(container, "email", "ux.review@example.com");
      fill(container, "password", "SuperSecret123!");
      fill(container, "confirmPassword", "SuperSecret123!");
      submit(container);

      await waitFor(() => {
        expect(screen.getByText(/name is required/i)).toBeTruthy();
      });
    });
  });

  describe("when everything matches", () => {
    it("submits", async () => {
      const { container } = renderPage();

      fill(container, "name", "UX Review");
      fill(container, "email", "ux.review@example.com");
      fill(container, "password", "SuperSecret123!");
      fill(container, "confirmPassword", "SuperSecret123!");
      submit(container);

      await waitFor(() => expect(mutateMock).toHaveBeenCalled());
    });
  });
});
