/**
 * @vitest-environment jsdom
 *
 * The join-before-create page, wired (D12 filling D13's hook).
 *
 * Two things are asserted here that no component test below it can: that the
 * page actually ASKS the server which organizations are open to this address,
 * and that the invariant this deliverable is named for holds at the only
 * place it can be broken — nothing on this page creates an organization for
 * somebody who did not choose to create one.
 *
 * Spec: specs/identity/join-before-create.feature,
 *       specs/identity/signin-signup-screens.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  lookupRef,
  mineRef,
  requestMock,
  admitMock,
  hardRedirectMock,
  invalidateMock,
} = vi.hoisted(() => ({
  lookupRef: { current: { data: undefined as unknown } },
  mineRef: { current: { data: undefined as unknown } },
  requestMock: vi.fn(),
  admitMock: vi.fn(),
  hardRedirectMock: vi.fn(),
  invalidateMock: vi.fn(),
}));

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      joinRequests: { mine: { invalidate: invalidateMock } },
    }),
    joinRequests: {
      lookup: { useQuery: () => lookupRef.current },
      mine: { useQuery: () => mineRef.current },
      request: { useMutation: () => ({ mutate: requestMock }) },
      admitAutomatically: { useMutation: () => ({ mutate: admitMock }) },
    },
  },
}));

vi.mock("~/hooks/useRequiredSession", () => ({
  useRequiredSession: () => ({
    data: { user: { id: "user_sam", email: "sam@acme.com" } },
  }),
}));

vi.mock("~/utils/hardRedirect", () => ({
  hardRedirect: (...args: unknown[]) => hardRedirectMock(...args),
}));

// The page stands on the auth screens' ground now rather than in the setup
// layout, and the shell asks the deployment which ground that is. Answered
// here rather than wrapped in a tRPC provider: these tests are about what the
// page ASKS and what it refuses to create, and a query client around them
// would only add a way to fail for an unrelated reason.
vi.mock("~/hooks/usePublicEnv", () => ({
  usePublicEnv: () => ({ data: { IS_SAAS: false } }),
}));

vi.mock("~/features/errors", () => ({
  showErrorToast: vi.fn(),
  // Stood in rather than rendered for real: what matters here is that the
  // page reaches the refusal branch at all, not which words the code-keyed
  // registry puts in it.
  HandledErrorAlert: ({ fallbackTitle }: { fallbackTitle: string }) => (
    <div data-testid="lookup-refusal">{fallbackTitle}</div>
  ),
}));

import Join from "../join";

const renderPage = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <Join />
    </ChakraProvider>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  lookupRef.current = {
    data: {
      outcome: "ask",
      organizations: [
        { organizationId: "org_acme", name: "Acme", colleagueCount: 10 },
      ],
    },
  };
  mineRef.current = { data: [] };
});

afterEach(() => cleanup());

describe("given a verified address an organization is open to", () => {
  describe("when sign-up reaches the join step", () => {
    /** @scenario Sign-up offers my team before offering a new workspace */
    it("leads with joining and keeps creating as the explicit secondary", async () => {
      renderPage();

      const buttons = await screen.findAllByRole("button");
      expect(buttons[0]).toHaveTextContent("Join Acme");
      expect(buttons[1]).toHaveTextContent("Create a new organization");
      // Nothing has happened yet: no workspace, no request, no navigation.
      expect(hardRedirectMock).not.toHaveBeenCalled();
      expect(requestMock).not.toHaveBeenCalled();
    });

    /** @scenario No organization is created for somebody who did not ask for one */
    it("asks to join without creating anything", async () => {
      renderPage();

      await userEvent.click(
        await screen.findByRole("button", { name: /Join Acme/ }),
      );

      expect(requestMock.mock.calls[0]?.[0]).toEqual({
        organizationId: "org_acme",
      });
      // The invariant, at the one place it can be broken: asking creates no
      // organization and does not send them to the screen that would.
      expect(hardRedirectMock).not.toHaveBeenCalled();
      expect(admitMock).not.toHaveBeenCalled();
    });

    /** @scenario No organization is created for somebody who did not ask for one */
    it("leaves them in no organization while the request is open", async () => {
      mineRef.current = { data: [{ organizationId: "org_acme" }] };
      renderPage();

      expect(
        await screen.findByText(/waiting for one of their administrators/i),
      ).toBeInTheDocument();
      // Creating one anyway stays available and stays a click, never an
      // automatic consequence of waiting.
      expect(
        screen.getByRole("button", {
          name: /Create a new organization anyway/,
        }),
      ).toBeInTheDocument();
      expect(hardRedirectMock).not.toHaveBeenCalled();
    });
  });
});

describe("given an organization that admits the domain automatically", () => {
  describe("when sign-up reaches the join step", () => {
    /** @scenario Sign-up offers my team before offering a new workspace */
    it("admits them once and shows no offer and no workspace step", async () => {
      lookupRef.current = {
        data: {
          outcome: "auto",
          organization: {
            organizationId: "org_acme",
            name: "Acme",
            colleagueCount: 10,
          },
        },
      };

      renderPage();

      await vi.waitFor(() => expect(admitMock).toHaveBeenCalledTimes(1));
      // Narrowed from "the page renders no test-id at all", which stopped
      // being the same statement when the page gained the auth screens' ground:
      // the shell is always there, and what must not be there is the STEP.
      // Named directly, so the assertion says what it means.
      expect(screen.queryByTestId("join-before-create")).toBeNull();
      expect(screen.queryByRole("button")).toBeNull();
    });
  });
});

describe("given a verified address nothing is open to", () => {
  describe("when sign-up reaches the join step", () => {
    it("carries straight on to workspace creation", async () => {
      lookupRef.current = { data: { outcome: "none" } };
      renderPage();

      await vi.waitFor(() =>
        expect(hardRedirectMock).toHaveBeenCalledWith("/"),
      );
      expect(requestMock).not.toHaveBeenCalled();
    });
  });
});

describe("given a lookup that could not be made", () => {
  describe("when sign-up reaches the join step", () => {
    /** @scenario A lookup that failed is not read as having found nothing */
    it("says the check could not be made, and creating stays an explicit choice", () => {
      lookupRef.current = {
        isError: true,
        error: new Error("lookup unavailable"),
        refetch: vi.fn(),
      } as unknown as { data: unknown };

      renderPage();

      // A lookup we could not make is not a lookup that found nothing. The
      // difference matters: carrying on would put somebody in an organization
      // of their own while their colleagues were already here.
      expect(screen.getByTestId("lookup-refusal")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /Create a new organization instead/ }),
      ).toBeInTheDocument();
      expect(hardRedirectMock).not.toHaveBeenCalled();
    });
  });
});
