/**
 * @vitest-environment jsdom
 *
 * The connectors page's own band: the connection, what the directory did, and
 * the way through to the connection itself.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  connections: [] as unknown[],
  recentChanges: [] as unknown[],
}));

vi.mock("~/utils/api", () => ({
  api: {
    scimReconciliation: {
      getAll: {
        useQuery: () => ({
          data: {
            connections: state.connections,
            recentChanges: state.recentChanges,
          },
          isLoading: false,
          isError: false,
          error: null,
        }),
      },
      getRequests: {
        useQuery: () => ({
          data: [],
          isLoading: false,
          isError: false,
          error: null,
        }),
      },
    },
  },
}));

const { ScimReconciliationPanel } = await import("../ScimReconciliationPanel");

const draw = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <ScimReconciliationPanel
        organizationId="org_acme"
        maySetUpSingleSignOn={true}
      />
    </ChakraProvider>,
  );

beforeEach(() => {
  state.connections = [
    {
      connectionId: "conn_1",
      providerId: "lw",
      verifiedDomains: ["acme1.test"],
      state: "ACTIVE",
      status: { headline: "Syncing", waitingFor: "", tone: "working" },
      lastPushedAtMs: Date.parse("2026-09-16T17:57:00Z"),
      managedPeople: 498,
      failures: [],
      remediation: "",
    },
  ];
  state.recentChanges = [];
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the connectors page's connection band", () => {
  describe("when an administrator opens it", () => {
    /** @scenario "What the provider sent is there for whoever needs it, and folded for everybody else" */
    it("folds what the provider sent away until it is asked for", () => {
      draw();

      // The raw request log is the lowest altitude and the narrowest
      // audience; it used to be open beside two other views of one sync.
      expect(screen.queryByTestId("directory-requests")).toBeNull();

      fireEvent.click(screen.getByTestId("directory-requests-toggle"));
      expect(screen.getByTestId("directory-requests")).toBeTruthy();
    });

    /** @scenario "The connection's name leads to the connection" */
    it("takes the reader from the connection's name to the connection", () => {
      draw();

      expect(screen.getByTestId("connector-provider-link")).toHaveAttribute(
        "href",
        "/settings/authentication/provider",
      );
    });

    /** @scenario "Changes to the connection itself are where they belong, and said so" */
    it("says where changes to the connection itself are, and links there", () => {
      draw();

      const pointer = screen.getByText(/changes to the connection itself/i);
      expect(within(pointer).getByRole("link")).toHaveAttribute(
        "href",
        "/settings/authentication/provider",
      );
    });
  });
});
