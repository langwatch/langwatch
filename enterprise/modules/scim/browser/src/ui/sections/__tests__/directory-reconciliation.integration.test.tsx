/**
 * @vitest-environment jsdom
 *
 * The directory-sync panel (ADR-122), in the words the server wrote, with no
 * control on it that would write.
 */

import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { state } = vi.hoisted(() => ({
  state: {
    panel: {
      connections: [] as Record<string, unknown>[],
      recentChanges: [] as Record<string, unknown>[],
    },
    isLoading: false,
  },
}));

vi.mock("../../../behavior/scim-api.ts", () => ({
  scimApi: {
    scimReconciliation: {
      getAll: {
        useQuery: () => ({ data: state.panel, isLoading: state.isLoading, isError: false }),
      },
    },
  },
}));

import { renderWithScimHost } from "../../../testing.tsx";
import { DirectoryReconciliation } from "../directory-reconciliation.tsx";

const PUSHED_AT = Date.UTC(2026, 8, 20, 9, 0, 0);

function connection(overrides: Record<string, unknown> = {}) {
  return {
    connectionId: "ssoconn_1",
    providerId: "Okta",
    verifiedDomains: ["acme.com"],
    connectionState: "ACTIVE",
    state: "SYNCING",
    status: {
      headline: "Syncing",
      waitingFor: "Your identity provider is pushing changes and they are being applied.",
      tone: "working",
    },
    lastPushedAtMs: PUSHED_AT,
    managedPeople: 12,
    failures: [] as Record<string, unknown>[],
    remediation:
      "Your identity provider's next push re-asserts everything it still believes, so fixing this in the directory is what puts it right.",
    ...overrides,
  };
}

beforeEach(() => {
  state.panel = { connections: [connection()], recentChanges: [] };
  state.isLoading = false;
});

afterEach(cleanup);

describe("given a connection the directory is pushing to", () => {
  /** @scenario "A connection's sync state is on the SCIM settings page" */
  it("names the state in words rather than in a code", () => {
    renderWithScimHost(<DirectoryReconciliation organizationId="org-1" />);

    expect(screen.getByText("Syncing")).toBeTruthy();
    expect(screen.getByText(/pushing changes/i)).toBeTruthy();
    expect(screen.queryByText(/SYNCING|TOKEN_ISSUED/)).toBeNull();
  });

  /** @scenario "The last push and the people managed are counted per connection" */
  it("shows when the directory last pushed and how many people it manages", () => {
    renderWithScimHost(<DirectoryReconciliation organizationId="org-1" />);

    expect(screen.getByText("Last push from the directory")).toBeTruthy();
    expect(screen.getByText("People this directory manages")).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.queryByText("No push yet")).toBeNull();
  });
});

describe("given a connection no directory has pushed to", () => {
  /** @scenario "A connection the directory has never pushed to says so calmly" */
  it("reads as waiting rather than as a failure", () => {
    state.panel = {
      connections: [
        connection({
          state: null,
          lastPushedAtMs: null,
          managedPeople: 0,
          status: {
            headline: "Not set up yet",
            waitingFor: "No directory token has been issued for this connection.",
            tone: "waiting",
          },
        }),
      ],
      recentChanges: [],
    };

    renderWithScimHost(<DirectoryReconciliation organizationId="org-1" />);

    expect(screen.getByText("Not set up yet")).toBeTruthy();
    expect(screen.getByText("No push yet")).toBeTruthy();
    expect(screen.queryByTestId("directory-failures")).toBeNull();
  });
});

describe("given a failed apply that is standing", () => {
  beforeEach(() => {
    state.panel = {
      connections: [
        connection({
          state: "ERROR",
          status: {
            headline: "Something the directory asked for has not been applied",
            waitingFor: "Your identity provider's next push re-asserts everything it believes.",
            tone: "attention",
          },
          failures: [
            {
              title: "Offboard incomplete",
              description: "Fixing it in the directory is what puts it right.",
              occurredAtMs: PUSHED_AT,
              retired: true,
            },
          ],
        }),
      ],
      recentChanges: [],
    };
  });

  /** @scenario "A failed apply reaches the administrator as words to act on" */
  it("lists the failure in words, with no code or record identifier", () => {
    renderWithScimHost(<DirectoryReconciliation organizationId="org-1" />);

    const failures = screen.getByTestId("directory-failures");
    expect(failures.textContent).toContain("Offboard incomplete");
    expect(failures.textContent).not.toContain("offboard_incomplete");
    expect(failures.textContent).not.toContain("ssoconn_1");
  });

  /** @scenario "The organization view offers no retry" */
  it("offers no re-run, and says the next push is what re-asserts it", () => {
    renderWithScimHost(<DirectoryReconciliation organizationId="org-1" />);

    expect(screen.queryByRole("button", { name: /retry|re-?run|re-?drive/i })).toBeNull();
    expect(screen.getByTestId("directory-failures").textContent).toMatch(/next push re-asserts/i);
  });
});

describe("given the directory removed somebody", () => {
  /** @scenario "People the directory removed are listed as the directory's act" */
  it("lists the change as a removal, with when it happened", () => {
    state.panel = {
      connections: [connection()],
      recentChanges: [
        {
          grantId: "grant_sam_member",
          summary: "Sam Patel lost access",
          author: "Your identity provider",
          occurredAtMs: PUSHED_AT,
          kind: "removed",
        },
      ],
    };

    renderWithScimHost(<DirectoryReconciliation organizationId="org-1" />);

    const changes = screen.getByTestId("directory-recent-changes");
    expect(changes.textContent).toContain("Sam Patel lost access");
    expect(changes.textContent).toContain("Removed");
    expect(changes.textContent).toContain(new Date(PUSHED_AT).toLocaleString());
  });
});

describe("given a connection that has been removed", () => {
  it("folds it away with the count, and says its people are still here", () => {
    state.panel = {
      connections: [
        connection(),
        connection({
          connectionId: "ssoconn_old",
          providerId: "Entra",
          connectionState: "TORN_DOWN",
          managedPeople: 40,
        }),
      ],
      recentChanges: [],
    };

    renderWithScimHost(<DirectoryReconciliation organizationId="org-1" />);

    expect(screen.queryByText("Entra")).toBeNull();
    fireEvent.click(screen.getByTestId("retired-connections-toggle"));
    expect(screen.getByTestId("retired-connection").textContent).toContain("40 still here");
  });
});

describe("given no connection at all", () => {
  it("says the step that would fill it, and draws no empty table", () => {
    state.panel = { connections: [], recentChanges: [] };

    renderWithScimHost(<DirectoryReconciliation organizationId="org-1" />);

    expect(screen.getByTestId("directory-no-connection").textContent).toContain(
      "No identity provider is connected yet",
    );
    expect(screen.queryByTestId("directory-connection")).toBeNull();
  });
});

describe("while the panel is still reading", () => {
  it("says it is loading rather than that nothing is connected", () => {
    state.isLoading = true;

    renderWithScimHost(<DirectoryReconciliation organizationId="org-1" />);

    expect(screen.getByTestId("scim-reconciliation-loading")).toBeTruthy();
    expect(screen.queryByTestId("directory-no-connection")).toBeNull();
  });
});
