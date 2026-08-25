/**
 * @vitest-environment jsdom
 *
 * The Directory page's summary band: which sources are connected, what the
 * directory has done, and who is here that it never put here.
 *
 * Spec: specs/identity/org-access-cluster.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  connections: [] as unknown[],
  groups: [] as unknown[],
  groupsError: null as unknown,
  provenance: {} as Record<string, unknown>,
}));

vi.mock("~/utils/api", () => ({
  api: {
    scimReconciliation: {
      getAll: {
        useQuery: () => ({
          data: { connections: state.connections, recentChanges: [] },
          isLoading: false,
          isError: false,
          error: null,
        }),
      },
    },
    group: {
      listAll: {
        useQuery: () => ({
          data: state.groups,
          isLoading: false,
          isError: state.groupsError !== null,
          error: state.groupsError,
        }),
      },
    },
    organization: {
      getMemberProvenance: {
        useQuery: () => ({
          data: state.provenance,
          isLoading: false,
          isError: false,
          error: null,
        }),
      },
    },
  },
}));

const { DirectorySummary } = await import("../DirectorySummary");

const wrap = (node: React.ReactNode) =>
  render(<ChakraProvider value={defaultSystem}>{node}</ChakraProvider>);

describe("given an organization whose directory is syncing", () => {
  beforeEach(() => {
    state.groupsError = null;
    state.connections = [
      {
        connectionId: "conn_1",
        providerId: "okta",
        verifiedDomains: ["acme.com"],
        state: "SYNCING",
        status: { headline: "Syncing", waitingFor: "", tone: "working" },
        lastPushedAtMs: Date.parse("2026-08-24T09:00:00Z"),
        managedPeople: 42,
        failures: [],
        remediation: "",
      },
    ];
    state.groups = [
      {
        id: "grp_1",
        name: "Platform Engineers",
        scimSource: "okta",
        memberCount: 7,
        bindings: [],
      },
      {
        id: "grp_2",
        name: "Hand-made",
        scimSource: null,
        memberCount: 2,
        bindings: [],
      },
    ];
    state.provenance = {
      user_a: { source: "directory", providerId: "okta" },
      user_b: { source: "invited" },
      user_c: { source: "domain", domain: "acme.com", automatic: true },
    };
  });
  afterEach(() => cleanup());

  describe("when the band leads the page", () => {
    /** @scenario The page leads with whether it is working */
    it("names the connected source, when it last pushed, and how many people and groups", () => {
      wrap(
        <DirectorySummary organizationId="org_acme" canReadMembership={true} />,
      );

      const summary = screen.getByTestId("directory-summary");
      const source = within(summary).getByTestId("directory-source-chip");
      expect(source.textContent).toContain("okta");
      expect(source.textContent).toContain("Syncing");
      expect(within(summary).getByText("42")).toBeInTheDocument();
      // One of the two groups came from the directory; the hand-made one is
      // not the directory's and is not counted as its work.
      expect(within(summary).getByText("1")).toBeInTheDocument();
      expect(summary.textContent).not.toContain("No push yet");
    });

    /** @scenario The people the directory did not put here are counted too */
    it("counts the members the directory does not manage against the whole membership", () => {
      wrap(
        <DirectorySummary organizationId="org_acme" canReadMembership={true} />,
      );

      const fact = screen.getByTestId("members-outside-directory");
      // Two of the three were invited or admitted by a domain.
      expect(fact.textContent).toBe("2 of 3");
      // The explanation is the tile's own visible line now, not a hover.
      expect(
        screen.getByText(
          /removing them from your directory will not remove them here/,
        ),
      ).toBeInTheDocument();
    });

    /** @scenario The page leads with whether it is working */
    it("says needs attention when something was not applied", () => {
      state.connections = [
        {
          ...(state.connections[0] as Record<string, unknown>),
          status: {
            headline: "Something has not been applied",
            waitingFor: "",
            tone: "attention",
          },
        },
      ];
      wrap(
        <DirectorySummary organizationId="org_acme" canReadMembership={true} />,
      );

      expect(screen.getByTestId("directory-source-chip").textContent).toContain(
        "Something has not been applied",
      );
    });

    /** @scenario The page leads with whether it is working */
    it("says not set up rather than pretending zero is a state", () => {
      state.connections = [];
      wrap(
        <DirectorySummary organizationId="org_acme" canReadMembership={true} />,
      );

      expect(screen.getByText("Not set up yet")).toBeInTheDocument();
    });
  });

  describe("when the reader may not read the membership", () => {
    /** @scenario A reader who may not read groups is told nothing they cannot have */
    it("says unavailable rather than a zero that reads as an answer", () => {
      wrap(
        <DirectorySummary
          organizationId="org_acme"
          canReadMembership={false}
        />,
      );

      const summary = screen.getByTestId("directory-summary");
      // Both membership facts, and neither of them shown as a count.
      expect(within(summary).getAllByText("Unavailable")).toHaveLength(2);
      expect(
        within(summary).queryByTestId("members-outside-directory"),
      ).toBeNull();
      // The three facts the sync itself answers are still on screen.
      expect(within(summary).getByText("42")).toBeInTheDocument();
    });
  });

  describe("when a membership read fails", () => {
    it("says what failed without taking the sync facts down with it", () => {
      state.groupsError = {
        message: "unknown_error",
        data: { httpStatus: 500 },
      };
      wrap(
        <DirectorySummary organizationId="org_acme" canReadMembership={true} />,
      );

      expect(
        screen.getByText(/Couldn't count the groups your directory sent/i),
      ).toBeInTheDocument();
      expect(screen.getByText("42")).toBeInTheDocument();
    });
  });
});
