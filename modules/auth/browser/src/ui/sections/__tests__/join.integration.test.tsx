/**
 * @vitest-environment jsdom
 * The join-before-create screen: it asks the server which organizations are
 * open to this address, and nothing on it creates an organization for
 * somebody who did not choose to. Spec: specs/identity/join-before-create.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ReadState = {
  data?: unknown;
  isPending?: boolean;
  isError?: boolean;
  error?: unknown;
  refetch?: () => void;
};

const { lookupRef, mineRef, requestMock, hardRedirectMock, invalidateMock, navigatingAwayRef } =
  vi.hoisted(() => {
    const lookup: { current: ReadState } = { current: {} };
    const mine: { current: ReadState } = { current: {} };
    const navigating: { current: boolean } = { current: false };
    return {
      lookupRef: lookup,
      mineRef: mine,
      requestMock: vi.fn(),
      hardRedirectMock: vi.fn(),
      invalidateMock: vi.fn(),
      navigatingAwayRef: navigating,
    };
  });

vi.mock("../../../behavior/auth-api.ts", () => ({
  authApi: {
    useUtils: () => ({ joinRequests: { mine: { invalidate: invalidateMock } } }),
    joinRequests: {
      lookup: { useQuery: () => lookupRef.current },
      mine: { useQuery: () => mineRef.current },
      request: { useMutation: () => ({ mutate: requestMock, error: null }) },
    },
  },
}));

vi.mock("../../../behavior/use-required-session.ts", () => ({
  useRequiredSession: () => ({ data: { user: { id: "user_sam", email: "sam@acme.com" } } }),
}));

vi.mock("../../../behavior/hard-redirect.ts", () => ({
  hardRedirect: hardRedirectMock,
  isNavigatingAway: () => navigatingAwayRef.current,
}));

vi.mock("../setup-layout.tsx", () => ({
  SetupLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

import Join from "../join-screen.tsx";

const renderScreen = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <Join />
    </ChakraProvider>,
  );

const acme = { organizationId: "org_acme", name: "Acme", colleagueCount: 10 };

beforeEach(() => {
  vi.clearAllMocks();
  navigatingAwayRef.current = false;
  lookupRef.current = { data: { outcome: "ask", organizations: [acme] } };
  mineRef.current = { data: [] };
});

afterEach(() => cleanup());

describe("given a verified address an organization is open to", () => {
  describe("when sign-up reaches the join step", () => {
    /** @scenario "Sign-up offers the team before offering a workspace" */
    /** @scenario "Sign-up offers my team before offering a new workspace" */
    it("leads with joining and keeps creating as the explicit secondary", async () => {
      renderScreen();

      const buttons = await screen.findAllByRole("button");
      expect(buttons[0]?.textContent).toMatch(/Join Acme/);
      expect(buttons[1]?.textContent).toMatch(/Create a new organization/);
      expect(hardRedirectMock).not.toHaveBeenCalled();
      expect(requestMock).not.toHaveBeenCalled();
    });

    /** @scenario "No organization is created for somebody who did not ask for one" */
    it("asks to join without creating anything", async () => {
      renderScreen();

      await userEvent.click(await screen.findByRole("button", { name: /Join Acme/ }));

      expect(requestMock.mock.calls[0]?.[0]).toEqual({ organizationId: "org_acme" });
      expect(hardRedirectMock).not.toHaveBeenCalled();
    });

    /** @scenario "A waiting requester can still create a workspace, deliberately" */
    it("leaves them in no organization while the request is open", async () => {
      mineRef.current = { data: [{ organizationId: "org_acme" }] };
      renderScreen();

      expect(await screen.findByText(/waiting for one of their administrators/i)).toBeDefined();
      expect(
        screen.getByRole("button", { name: /Create a new organization anyway/ }),
      ).toBeDefined();
      expect(hardRedirectMock).not.toHaveBeenCalled();
    });
  });
});

describe("given an organization that admits the domain automatically", () => {
  describe("when sign-up reaches the join step", () => {
    /** @scenario "Automatic joining skips the step entirely" */
    it("asks to join once, lands, and shows no offer and no workspace step", async () => {
      lookupRef.current = { data: { outcome: "auto", organization: acme } };
      renderScreen();

      await vi.waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
      expect(requestMock.mock.calls[0]?.[0]).toEqual({ organizationId: "org_acme" });
      expect(screen.queryByTestId("join-before-create")).toBeNull();
      expect(screen.queryByRole("button")).toBeNull();
    });
  });
});

describe("given a verified address nothing is open to", () => {
  describe("when sign-up reaches the join step", () => {
    /** @scenario "With nothing to offer, sign-up continues exactly as before" */
    it("carries straight on to workspace creation", async () => {
      lookupRef.current = { data: { outcome: "none" } };
      renderScreen();

      await vi.waitFor(() => expect(hardRedirectMock).toHaveBeenCalledWith("/"));
      expect(requestMock).not.toHaveBeenCalled();
    });
  });
});

describe("given the lookup has not answered yet", () => {
  describe("when the join step is reached", () => {
    /** @scenario "The step waits for its own answer before sending anybody anywhere" */
    it("offers nothing and sends nobody anywhere", () => {
      lookupRef.current = { isPending: true };
      renderScreen();

      expect(screen.queryByRole("button")).toBeNull();
      expect(hardRedirectMock).not.toHaveBeenCalled();
    });
  });
});

describe("given a lookup that could not be made", () => {
  describe("when sign-up reaches the join step", () => {
    /** @scenario "A lookup that failed is not read as having found nothing" */
    it("says the check could not be made, and creating stays an explicit choice", () => {
      lookupRef.current = {
        isError: true,
        error: new Error("lookup unavailable"),
        refetch: vi.fn(),
      };
      renderScreen();

      expect(screen.getByTestId("join-lookup-failed")).toBeDefined();
      expect(
        screen.getByRole("button", { name: /Create a new organization instead/ }),
      ).toBeDefined();
      expect(hardRedirectMock).not.toHaveBeenCalled();
    });
  });

  describe("when the page is already on its way somewhere else", () => {
    it("waits, rather than reading its own departure as a failure", () => {
      navigatingAwayRef.current = true;
      lookupRef.current = { isError: true, error: new Error("aborted"), refetch: vi.fn() };
      renderScreen();

      expect(screen.queryByTestId("join-lookup-failed")).toBeNull();
    });
  });
});
