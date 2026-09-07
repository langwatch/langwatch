/**
 * @vitest-environment jsdom
 *
 * The operator identity lookup's page: the routing answer, what was typed
 * against what it resolved to, and the people who hold it.
 *
 * Corresponds to specs/identity/platform-ops-identity-lookup.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SIGN_IN_ROUTING_REASON_COPY } from "~/features/auth/logic/routingReasonCopy";
import IdentityLookupView from "../IdentityLookupView";
import { shortenIdentifier } from "../identityLookupCopy";

const lookupState = vi.hoisted(() => ({
  current: {
    data: undefined as unknown,
    isLoading: false,
    isFetching: false,
    error: null as Error | null,
  },
}));
const queueState = vi.hoisted(() => ({ current: { data: [] as unknown[] } }));
const activityState = vi.hoisted(() => ({
  current: { data: [] as unknown[] },
}));
const routerState = vi.hoisted(() => ({
  query: {} as Record<string, string>,
  replace: vi.fn(),
}));

vi.mock("~/utils/api", () => {
  const mutation = () => ({ useMutation: () => ({ mutate: vi.fn() }) });
  return {
    api: {
      useContext: () => ({ identityLookup: { invalidate: vi.fn() } }),
      identityLookup: {
        resolve: { useQuery: () => lookupState.current },
        person: { useQuery: () => ({ data: undefined, error: null }) },
        claimQueue: { useQuery: () => queueState.current },
        recentActivity: { useQuery: () => activityState.current },
        confirmProposedSignIn: mutation(),
        rejectProposedSignIn: mutation(),
        detachMethod: mutation(),
        endSessions: mutation(),
        resendInvitation: mutation(),
        extendInvitation: mutation(),
      },
    },
  };
});

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    query: routerState.query,
    replace: routerState.replace,
  }),
}));

vi.mock("~/components/ui/toaster", () => ({ toaster: { create: vi.fn() } }));

/** The debounce would otherwise hold the address for 300ms of fake time. */
vi.mock("use-debounce", () => ({
  useDebounce: (value: string) => [value],
}));

function answer(overrides: Record<string, unknown> = {}) {
  return {
    typed: "Sam+Support@ACME.com",
    resolved: "sam+support@acme.com",
    domain: "acme.com",
    canRepair: true,
    routing: {
      outcome: "method_picker",
      reasonCode: "connection_suspended",
      connectionId: null,
      methods: ["password"],
      connection: {
        connectionId: "ssoc_acme",
        organizationId: "org_LVYcVYGW1AJqvp2G8vcVd",
        organizationName: "Acme",
        state: "SUSPENDED",
        providerId: "acme-okta",
      },
    },
    people: [
      {
        userId: "user_LVYcVYGW1AJqvp2G8vcVd",
        name: "Sam Carter",
        email: "sam@acme.com",
        organizations: [
          { organizationId: "org_acme", name: "Acme", role: "MEMBER" },
        ],
        holding: [
          { identifierId: "idf_1", provider: "email", state: "VERIFIED" },
        ],
      },
      {
        userId: "user_older",
        name: "Sam (older account)",
        email: null,
        organizations: [],
        holding: [
          { identifierId: "idf_2", provider: "email", state: "DETACHED" },
        ],
      },
    ],
    ...overrides,
  };
}

function renderView() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <IdentityLookupView />
    </ChakraProvider>,
  );
}

describe("given an operator who has resolved an address", () => {
  beforeEach(() => {
    lookupState.current = {
      data: answer(),
      isLoading: false,
      isFetching: false,
      error: null,
    };
    queueState.current = { data: [] };
    activityState.current = { data: [] };
    routerState.query = {};
  });

  describe("when the answer is rendered", () => {
    /** @scenario "One address answers the question the auth screens would answer" */
    it("shows the decision with its reason, in the words the person would have read", () => {
      renderView();

      expect(screen.getByTestId("routing-reason")).toHaveTextContent(
        "connection_suspended",
      );

      // Not copy written here: the exact entry the auth screens renders for
      // this reason code.
      const registered = SIGN_IN_ROUTING_REASON_COPY.connection_suspended;
      if (!registered) throw new Error("no auth-screen copy for the reason");
      expect(screen.getByText(registered.title)).toBeInTheDocument();
      expect(screen.getByText(registered.describe)).toBeInTheDocument();
    });

    /** @scenario "The address is resolved the way the auth screens resolves it" */
    it("shows what was typed and what it resolved to, both", () => {
      renderView();

      expect(screen.getByText("Sam+Support@ACME.com")).toBeInTheDocument();
      expect(screen.getByTestId("resolved-address")).toHaveTextContent(
        "sam+support@acme.com",
      );
    });

    /** @scenario "An organization's own connection state is readable from the person who signs in through it" */
    it("names the connection and its state beside the decision", () => {
      renderView();

      const beside = screen.getByTestId("routing-connection");
      expect(beside).toHaveTextContent("Acme");
      expect(beside).toHaveTextContent("suspended");
    });

    /** @scenario "People and organizations are shown by name, never by identifier alone" */
    it("names people and organizations, and shortens an identifier it must show", () => {
      renderView();

      expect(screen.getByText("Sam Carter")).toBeInTheDocument();
      expect(screen.getByText("Acme")).toBeInTheDocument();

      // The identifier that has to be shown is shortened in its middle and
      // copyable whole.
      expect(
        screen.getByText(shortenIdentifier("user_LVYcVYGW1AJqvp2G8vcVd")),
      ).toBeInTheDocument();
      expect(
        screen.getByLabelText("Copy user_LVYcVYGW1AJqvp2G8vcVd"),
      ).toBeInTheDocument();
    });
  });

  describe("when more than one person holds the address", () => {
    /** @scenario "Every person holding any part of the address is listed" */
    it("lists them all, neither presented as the only answer", () => {
      renderView();

      expect(screen.getByText("Sam Carter")).toBeInTheDocument();
      expect(screen.getByText("Sam (older account)")).toBeInTheDocument();
      expect(screen.getByText("email (DETACHED)")).toBeInTheDocument();
    });
  });

  describe("when nothing is waiting in the claims queue", () => {
    /** @scenario "The claims queue puts the longest wait first and says how long it has been" */
    it("empty-states in one line, and orders the queue as the server hands it over", () => {
      renderView();
      expect(screen.getByTestId("claim-queue-empty")).toHaveTextContent(
        "Nothing is waiting.",
      );

      queueState.current = {
        data: [
          {
            connectionId: "ssoc_old",
            organizationId: "org_old",
            organizationName: "Old Co",
            domain: "old.example",
            waitingSinceMs: Date.now() - 9 * 24 * 60 * 60 * 1000,
          },
          {
            connectionId: "ssoc_new",
            organizationId: "org_new",
            organizationName: "New Co",
            domain: "new.example",
            waitingSinceMs: Date.now() - 60 * 60 * 1000,
          },
        ],
      };
      renderView();

      expect(
        screen.getByText("waiting 9 days", { exact: false }),
      ).toBeVisible();
      expect(
        screen.getByText("waiting 1 hour", { exact: false }),
      ).toBeVisible();
    });
  });
});

describe("given an operator who may look but may not repair", () => {
  beforeEach(() => {
    lookupState.current = {
      data: answer({ canRepair: false }),
      isLoading: false,
      isFetching: false,
      error: null,
    };
    queueState.current = { data: [] };
    activityState.current = { data: [] };
  });

  describe("when she opens a person's actions", () => {
    /** @scenario "An operator who may look but not repair is shown nothing they cannot use" */
    it("renders everything readable and no repair at all", () => {
      renderView();

      // Everything readable is readable.
      expect(screen.getByText("Sam Carter")).toBeInTheDocument();
      expect(screen.getByTestId("routing-reason")).toBeInTheDocument();

      // And no repair is rendered, rather than rendered and refused when
      // pressed.
      expect(screen.queryByText("End every session")).not.toBeInTheDocument();
    });
  });
});
