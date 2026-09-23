/**
 * @vitest-environment jsdom
 * A cutover as an administrator meets it: what is serving sign-in, who has
 * not moved across, and the two levers — each offered only when pressing it
 * would do something, and neither offered to somebody who may only read.
 */

import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MigrationMembersView, MigrationView } from "../../../model/migration-route.ts";
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
      stragglers: [{ userId: "user-1", name: "Ana", email: null, lastLegacyAuthenticationAtMs: 1 }],
      nextCursor: "cursor-2",
    },
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

    expect(container.textContent).toContain("Auth0 migration");
    expect(container.textContent).toContain("4 of 10");
    expect(container.textContent).toContain("needs repointing");
    expect(container.textContent).toContain("acme.test (published domain proof)");
  });

  it("switches the route when the switch is pressed", () => {
    const { onSelectRoute } = renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Switch to new SSO" }));

    expect(onSelectRoute).toHaveBeenCalledWith("direct");
  });

  /** @scenario "Migration routing waits for the replacement to be active" */
  it("refuses the switch while the replacement is not on, and allows it once it is", () => {
    const off = renderSection({ connectionActive: false });
    expect(screen.getByRole("button", { name: "Switch to new SSO" })).toBeDisabled();
    off.unmount();

    renderSection({ connectionActive: true });
    expect(screen.getByRole("button", { name: "Switch to new SSO" })).toBeEnabled();
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
    const retry = screen.getByRole("button", { name: "Retry finalization" });
    expect(retry).toBeEnabled();
  });

  /** @scenario "Finalizing a migration closes its route controls" */
  it("offers nothing at all once it is finalized", () => {
    const { container } = renderSection({ migration: { phase: "FINALIZED" } });

    expect(screen.queryByTestId("sso-migration-route")).toBeNull();
    expect(screen.queryByTestId("sso-migration-finalize")).toBeNull();
    expect(container.textContent).toContain("Auth0 migration");
  });
});

describe("given a reader who may not manage single sign-on", () => {
  /** @scenario "Reading migration progress does not grant permission to change it" */
  it("shows the members who have not moved across and offers no lever", () => {
    const { container } = renderSection({ canManage: false });

    expect(container.textContent).toContain("Still using Auth0");
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
      members: { activeCount: 10, linkedCount: 10, stragglers: [], nextCursor: null },
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

    expect(container.textContent).toContain("We could not read who is still using Auth0");
    expect(screen.getByRole("button", { name: "Previous members" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Retry members" }));

    expect(onRetryMembers).toHaveBeenCalledOnce();
  });
});

describe("given a migration whose members are no longer readable", () => {
  it("says so rather than showing a stale page", () => {
    const { container } = renderSection({ membersUnavailable: true, showPreviousMembers: true });

    expect(container.textContent).toContain("Migration progress is no longer available");
  });
});
