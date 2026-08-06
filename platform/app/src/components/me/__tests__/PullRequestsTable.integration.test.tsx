/**
 * @vitest-environment jsdom
 *
 * The personal Pull Requests table: what a viewer is told when GitHub is not
 * connected, and what a repository the connection does not cover is offered.
 *
 * The tRPC surface is a proxy that answers every query empty unless a test
 * pins it, so the table's two reads (the usage rollup and the live status)
 * are the only wiring under test.
 *
 * @see specs/coding-agent/pull-request-linkage.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const { queryImpls, permissionsRef } = vi.hoisted(() => ({
  queryImpls: {} as Record<string, (input: unknown) => unknown>,
  permissionsRef: { canManageOrganization: true },
}));

vi.mock("~/utils/api", () => {
  const defaultQuery = () => ({
    data: undefined,
    isLoading: false,
    isError: false,
    isFetched: true,
  });
  const hooksFor = (path: string): Map<string, unknown> => {
    const useQuery = (input: unknown) =>
      (queryImpls[path] ?? defaultQuery)(input);
    return new Map<string, unknown>([
      ["useQuery", useQuery],
      ["useInfiniteQuery", useQuery],
    ]);
  };
  const makeNode = (path: string): unknown => {
    const hooks = hooksFor(path);
    return new Proxy(
      {},
      {
        get: (_target, prop) =>
          typeof prop === "string"
            ? (hooks.get(prop) ?? makeNode(path ? `${path}.${prop}` : prop))
            : undefined,
      },
    );
  };
  return { api: makeNode("") };
});

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    organization: { id: "org-1", name: "Acme" },
    organizations: [],
    project: undefined,
    team: undefined,
    hasPermission: (permission: string) =>
      permission === "organization:manage"
        ? permissionsRef.canManageOrganization
        : true,
    isLoading: false,
    isFetched: true,
  }),
}));

import { PullRequestsTable } from "../PullRequestsTable";

const INSTALL_URL = "/api/github/install?organizationId=org-1";

function pinUsage(data: unknown) {
  queryImpls["codingAgents.pullRequestUsage"] = () => ({
    data,
    isLoading: false,
    isError: false,
    isFetched: true,
  });
}

function pinStatuses(statuses: unknown[]) {
  queryImpls["github.pullRequestLiveStatus"] = () => ({
    data: { statuses },
    isLoading: false,
    isError: false,
    isFetched: true,
  });
}

function renderTable() {
  return render(
    <ChakraProvider value={defaultSystem}>
      <PullRequestsTable projectId="proj-personal" />
    </ChakraProvider>,
  );
}

beforeEach(() => {
  for (const key of Object.keys(queryImpls)) delete queryImpls[key];
  permissionsRef.canManageOrganization = true;
  pinStatuses([]);
});

afterEach(() => {
  cleanup();
});

describe("the personal Pull Requests table", () => {
  describe("given an organization with no GitHub connection", () => {
    /** @scenario "A viewer without a GitHub connection sees the connect invitation" */
    it("invites an organization manager to connect and tells everyone else to ask an administrator", () => {
      pinUsage({
        rows: [],
        unlinked: [],
        connection: { connected: false, installUrl: INSTALL_URL },
      });

      renderTable();
      expect(screen.getByText("GitHub is not connected")).toBeInTheDocument();
      const connect = screen.getByText("Connect GitHub").closest("a");
      expect(connect).toHaveAttribute("href", INSTALL_URL);

      cleanup();
      permissionsRef.canManageOrganization = false;
      renderTable();
      expect(screen.getByText(/ask an administrator/i)).toBeInTheDocument();
      expect(screen.queryByText("Connect GitHub")).not.toBeInTheDocument();
    });
  });

  describe("given a session whose repository no installation covers", () => {
    beforeEach(() => {
      pinUsage({
        rows: [],
        unlinked: [
          {
            repositoryHost: "github.com",
            repositoryFullName: "acme/widgets",
            headBranch: "feat/git-context",
            sessionsCount: 3,
            totalTokens: 1_240_000,
            costUsd: 4.25,
            repoCovered: false,
          },
        ],
        connection: { connected: true, installUrl: INSTALL_URL },
      });
    });

    /** @scenario "A session repository not covered by the connection offers linking it" */
    it("offers an organization manager the option to link that repository", async () => {
      const user = userEvent.setup();
      renderTable();

      expect(screen.getByText("acme/widgets")).toBeInTheDocument();
      await user.click(
        screen.getByRole("button", { name: "Actions for feat/git-context" }),
      );

      // Deep links to the GitHub App installation page, where the repository
      // is added to the organization's connection.
      const link = await screen.findByText("Link this repository");
      expect(link.closest("a")).toHaveAttribute("href", INSTALL_URL);
      expect(link.closest("[data-disabled]")).toBeNull();
    });

    it("disables linking for someone who may not manage the organization", async () => {
      permissionsRef.canManageOrganization = false;
      const user = userEvent.setup();
      renderTable();

      await user.click(
        screen.getByRole("button", { name: "Actions for feat/git-context" }),
      );

      const link = await screen.findByText("Link this repository");
      expect(link.closest("[data-disabled]")).not.toBeNull();
    });
  });

  describe("given a mapped pull request whose status came from a snapshot", () => {
    beforeEach(() => {
      pinUsage({
        rows: [
          {
            repositoryHost: "github.com",
            repositoryFullName: "acme/widgets",
            prNumber: 4218,
            headBranch: "feat/git-context",
            htmlUrl: "https://github.com/acme/widgets/pull/4218",
            state: "open",
            isDraft: false,
            authorLogin: "acme-dev",
            prCreatedAtMs: Date.parse("2026-07-01T09:00:00Z"),
            prClosedAtMs: null,
            prMergedAtMs: null,
            sessionsCount: 6,
            inputTokens: 1_000,
            outputTokens: 2_000,
            cacheReadTokens: 3_000,
            cacheCreationTokens: 4_000,
            totalTokens: 10_000,
            costUsd: 12.5,
          },
        ],
        unlinked: [],
        connection: { connected: true, installUrl: INSTALL_URL },
      });
    });

    it("shows the pull request number, its totals and a live status chip", () => {
      pinStatuses([
        {
          repositoryHost: "github.com",
          repositoryFullName: "acme/widgets",
          prNumber: 4218,
          status: "open",
          source: "live",
          mappedAt: new Date("2026-07-01T10:00:00Z"),
        },
      ]);

      renderTable();

      expect(screen.getByText("#4218").closest("a")).toHaveAttribute(
        "href",
        "https://github.com/acme/widgets/pull/4218",
      );
      const chip = screen.getByText("Open");
      expect(chip).toHaveAttribute("data-status-source", "live");
      // Counts read in full, never shortened.
      expect(screen.getByText("10,000")).toBeInTheDocument();
      expect(screen.getByText("6")).toBeInTheDocument();
    });

    it("draws a snapshot status back and says when it is from", async () => {
      pinStatuses([
        {
          repositoryHost: "github.com",
          repositoryFullName: "acme/widgets",
          prNumber: 4218,
          status: "merged",
          source: "snapshot",
          mappedAt: new Date("2026-07-01T10:00:00Z"),
        },
      ]);
      const user = userEvent.setup();

      renderTable();

      // The live chip is solid; a snapshot is outlined and muted, so the two
      // never read the same at a glance.
      const chip = screen.getByText("Merged");
      expect(chip).toHaveAttribute("data-status-source", "snapshot");

      await user.hover(chip);
      const tooltip = await screen.findByText(/last known status, from/i);
      expect(tooltip).toHaveTextContent(
        new Date("2026-07-01T10:00:00Z").toLocaleDateString(),
      );
    });
  });
});
