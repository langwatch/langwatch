/**
 * @vitest-environment jsdom
 * A cutover as an administrator meets it: what is serving sign-in, who has
 * not moved across, and the two levers — each offered only when pressing it
 * would do something, and neither offered to somebody who may only read.
 */

import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  UPDATE_CHECK_CODES,
  UPDATE_FINISH_CONDITIONS,
  type MigrationMembersView,
  type MigrationView,
} from "../../../model/migration-route.ts";
import { renderWithSsoHost } from "../../../testing.tsx";
import { MigrationProgressSection } from "../migration-progress.section.tsx";

function migrationOf(overrides: Partial<MigrationView> = {}): MigrationView {
  return {
    legacy: { connectionId: "connection-legacy", providerId: "auth0" },
    replacement: { connectionId: "connection-new", providerId: "okta-primary" },
    phase: "GRACE_LEGACY",
    selectedRoute: "legacy",
    inheritedDomains: [{ domain: "acme.test", method: "dns-txt" }],
    testSignIn: { done: true },
    members: {
      activeCount: 10,
      linkedCount: 4,
      nextSignInCount: 0,
      stragglers: [
        {
          userId: "user-1",
          name: "Ana",
          email: null,
          lastLegacyAuthenticationAtMs: 1,
          move: "no-address",
        },
      ],
      nextCursor: "cursor-2",
    },
    quietPeriod: { clearsAtMs: null },
    scim: { status: "needs-repointing" },
    blockers: [],
    canFinalize: false,
    ...overrides,
  };
}

function renderSection(
  overrides: {
    migration?: Partial<MigrationView>;
    canManage?: boolean;
    connectionActive?: boolean;
    members?: MigrationMembersView;
    membersFailed?: boolean;
    membersUnavailable?: boolean;
    showPreviousMembers?: boolean;
  } = {},
) {
  const onSelectRoute = vi.fn();
  const onFinalize = vi.fn();
  const onNextMembers = vi.fn();
  const onPreviousMembers = vi.fn();
  const onRetryMembers = vi.fn();
  const rendered = renderWithSsoHost(
    <MigrationProgressSection
      migration={migrationOf(overrides.migration)}
      canManage={overrides.canManage ?? true}
      connectionActive={overrides.connectionActive ?? true}
      members={overrides.members}
      membersFailed={overrides.membersFailed ?? false}
      membersUnavailable={overrides.membersUnavailable ?? false}
      showPreviousMembers={overrides.showPreviousMembers ?? false}
      onSelectRoute={onSelectRoute}
      onFinalize={onFinalize}
      onNextMembers={onNextMembers}
      onPreviousMembers={onPreviousMembers}
      onRetryMembers={onRetryMembers}
    />,
  );

  return {
    ...rendered,
    onSelectRoute,
    onFinalize,
    onNextMembers,
    onPreviousMembers,
    onRetryMembers,
  };
}

afterEach(cleanup);

describe("given a migration still on the old route", () => {
  it("says who is serving sign-in, how far the members have come and where the domain's trust came from", () => {
    const { container } = renderSection();

    expect(container.textContent).toContain("Replacing Auth0");
    expect(container.textContent).toContain("4 of 10");
    expect(container.textContent).toContain("Set it up on your new connection before you finish");
    expect(container.textContent).toContain("acme.test (published domain proof)");
  });

  it("switches the route when the switch is pressed", () => {
    const { onSelectRoute } = renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Switch sign-in over" }));

    expect(onSelectRoute).toHaveBeenCalledWith("direct");
  });

  /** @scenario "Migration routing waits for the replacement to be active" */
  it("refuses the switch while the replacement is not on, and allows it once it is", () => {
    const off = renderSection({ connectionActive: false });
    expect(screen.getByRole("button", { name: "Switch sign-in over" })).toBeDisabled();
    off.unmount();

    renderSection({ connectionActive: true });
    expect(screen.getByRole("button", { name: "Switch sign-in over" })).toBeEnabled();
  });

  it("shows what is in the way when the cutover names blockers", () => {
    const { container } = renderSection({
      migration: { blockers: [{ code: "scim", message: "Point your directory at the new one" }] },
    });

    expect(container.textContent).toContain("Point your directory at the new one");
  });
});

describe("given a migration being finalized", () => {
  /** @scenario "Finalizing a migration closes its route controls" */
  it("stops offering the route, and offers the finalization again", () => {
    renderSection({ migration: { phase: "FINALIZING", canFinalize: true } });

    expect(screen.queryByTestId("sso-migration-route")).toBeNull();
    const retry = screen.getByRole("button", { name: "Try finishing again" });
    expect(retry).toBeEnabled();
  });

  /** @scenario "Finalizing a migration closes its route controls" */
  it("offers nothing at all once it is finalized", () => {
    const { container } = renderSection({ migration: { phase: "FINALIZED" } });

    expect(screen.queryByTestId("sso-migration-route")).toBeNull();
    expect(screen.queryByTestId("sso-migration-finalize")).toBeNull();
    expect(container.textContent).toContain("Replacing Auth0");
  });
});

describe("given a reader who may not manage single sign-on", () => {
  /** @scenario "Reading migration progress does not grant permission to change it" */
  it("shows the members who have not moved across and offers no lever", () => {
    const { container } = renderSection({ canManage: false });

    expect(container.textContent).toContain("Not moved across yet");
    expect(container.textContent).toContain("Ana");
    expect(screen.queryByTestId("sso-migration-route")).toBeNull();
    expect(screen.queryByTestId("sso-migration-finalize")).toBeNull();
  });
});

describe("given more members than one page holds", () => {
  /** @scenario "Every member still using the old provider can be reached" */
  it("asks for the next page by the cursor the read gave, and offers the way back", () => {
    const { onNextMembers, onPreviousMembers } = renderSection({ showPreviousMembers: true });
    fireEvent.click(screen.getByRole("button", { name: "Next members" }));
    fireEvent.click(screen.getByRole("button", { name: "Previous members" }));

    expect(onNextMembers).toHaveBeenCalledWith("cursor-2");
    expect(onPreviousMembers).toHaveBeenCalledOnce();
  });

  it("says a page with nobody on it is empty rather than hiding the panel", () => {
    const { container } = renderSection({
      showPreviousMembers: true,
      members: {
        activeCount: 10,
        linkedCount: 10,
        nextSignInCount: 0,
        stragglers: [],
        nextCursor: null,
      },
    });

    expect(container.textContent).toContain("No remaining members on this page");
  });
});

describe("given a page of members that could not be read", () => {
  /** @scenario "A migration member page that failed can be retried" */
  it("shows the failure instead of an empty roster, with the retry and the way back", () => {
    const { container, onRetryMembers } = renderSection({
      membersFailed: true,
      showPreviousMembers: true,
    });

    expect(container.textContent).toContain("We could not load the members not moved across yet");
    expect(screen.getByRole("button", { name: "Previous members" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Retry members" }));

    expect(onRetryMembers).toHaveBeenCalledOnce();
  });
});

describe("given a migration whose members are no longer readable", () => {
  it("says so rather than showing a stale page", () => {
    const { container } = renderSection({ membersUnavailable: true, showPreviousMembers: true });

    expect(container.textContent).toContain("This list is no longer available");
  });
});

describe("given an update under way", () => {
  describe("when the new connection is registered and nothing has moved", () => {
    /** @scenario "The update reports where it stands and what is outstanding" */
    it("says who is signing people in and that nothing has changed for them", () => {
      renderSection({ migration: { phase: "SETUP" } });

      expect(screen.getByTestId("sso-update-status").textContent).toBe(
        "Everyone still signs in through Auth0. Set the new connection up and test it, and nothing changes for your members until you switch over.",
      );
      expect(screen.getByTestId("sso-update-chip").textContent).toContain("Setting up");
    });
  });

  describe("when sign-in has been switched to the new connection", () => {
    /** @scenario "The update reports where it stands and what is outstanding" */
    it("names the new connection and says the way back is still open", () => {
      renderSection({
        migration: {
          phase: "GRACE_DIRECT",
          selectedRoute: "direct",
          replacement: { connectionId: "connection-new", providerId: "okta" },
        },
      });

      expect(screen.getByTestId("sso-update-status").textContent).toBe(
        "Everyone signs in through Okta. You can switch back to Auth0 until you start finishing the update.",
      );
      expect(screen.getByTestId("sso-update-chip").textContent).toContain("Switched over");
    });
  });

  describe("when members have not signed in through the new connection yet", () => {
    /** @scenario "Members never hold the update" */
    it("says beside each member whether the new connection will recognise them", () => {
      const moves = ["matched", "no-address", "shared-address", "unproved-domain"] as const;
      renderSection({
        migration: {
          members: {
            activeCount: 5,
            linkedCount: 1,
            nextSignInCount: 1,
            stragglers: moves.map((move, index) => ({
              userId: `user-${index}`,
              name: `Member ${index}`,
              email: null,
              lastLegacyAuthenticationAtMs: null,
              move,
            })),
            nextCursor: null,
          },
        },
      });

      expect(screen.getAllByTestId("sso-update-member").map((row) => row.textContent)).toEqual([
        "Member 0 · Moves across at their next sign-in",
        "Member 1 · Will not be recognized: their account has no email address",
        "Member 2 · Will not be recognized: another account has the same address",
        "Member 3 · Will not be recognized: their address is not on a domain you proved",
      ]);
      expect(screen.getByText("1 of 5, 1 more at their next sign-in")).toBeInTheDocument();
    });
  });

  describe("when checks are outstanding", () => {
    /** @scenario "The update reports where it stands and what is outstanding" */
    it("says what to do about each one, in the customer's own words", () => {
      const { container } = renderSection({
        migration: {
          blockers: [
            {
              code: "legacy-activity-not-quiet",
              message:
                "Wait two days after the switch-over, and seven after the last legacy sign-in since then.",
            },
          ],
        },
      });

      expect(container.textContent).toContain(
        "You can finish two days after switching over, or seven days after the last sign-in through Auth0 since then, whichever is later.",
      );
      expect(container.textContent).not.toContain("legacy sign-in");
    });

    /** @scenario "The quiet period counts from the switch-over and the last sign-in through the previous provider" */
    it("shows the time finishing opens once sign-in is switched over", () => {
      const clearsAtMs = Date.parse("2026-09-03T09:30:00.000Z");
      const { container } = renderSection({
        migration: {
          phase: "GRACE_DIRECT",
          selectedRoute: "direct",
          quietPeriod: { clearsAtMs },
          blockers: [{ code: "legacy-activity-not-quiet", message: "x" }],
        },
      });

      expect(container.textContent).toContain(
        `You can finish from ${new Date(clearsAtMs).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}. A sign-in through Auth0 moves this to seven days after it.`,
      );
    });

    /** @scenario "Finishing waits for directory sync on the new connection while nothing moves it across" */
    it("asks for directory sync on the new connection rather than saying finishing moves it", () => {
      const { container } = renderSection({
        migration: {
          phase: "GRACE_DIRECT",
          selectedRoute: "direct",
          blockers: [{ code: "scim-needs-repointing", message: "x" }],
        },
      });

      expect(container.textContent).toContain("Set directory sync up on your new connection.");
      expect(container.textContent).not.toContain("Moves across when you finish");
    });

    /** @scenario "The update reports where it stands and what is outstanding" */
    it("offers the whole list of conditions without leaving the page", () => {
      renderSection({
        migration: { blockers: [{ code: "replacement-not-tested", message: "x" }] },
      });

      expect(screen.getByTestId("sso-update-conditions-help")).toBeDefined();
      expect(UPDATE_FINISH_CONDITIONS.length).toBe(UPDATE_CHECK_CODES.length);
    });
  });

  describe("when any phase is rendered", () => {
    /** @scenario "The update reports where it stands and what is outstanding" */
    it("never calls any of it a migration", () => {
      for (const phase of [
        "SETUP",
        "GRACE_LEGACY",
        "GRACE_DIRECT",
        "FINALIZING",
        "FINALIZED",
      ] as const) {
        const { container } = renderSection({
          migration: { phase, blockers: [{ code: "replacement-not-active", message: "x" }] },
        });
        expect(container.textContent?.toLowerCase()).not.toContain("migrat");
        cleanup();
      }
    });
  });
});
