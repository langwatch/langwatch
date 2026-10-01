/**
 * @vitest-environment jsdom
 * A member with a pending single sign-on switch has nothing to link in settings,
 * so the banner sends them to sign out. Spec: specs/auth/sso-wrong-provider-recovery.feature.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WithStubNavigationHost } from "../../../testing.tsx";
import { ShellPageBody } from "../shell-page-body.tsx";

const { ssoStatus } = vi.hoisted(() => ({
  ssoStatus: { data: undefined as { pendingSsoSetup: boolean } | undefined },
}));

vi.mock("../../../behavior/navigation-api.ts", () => ({
  navigationApi: {
    limits: { getUsage: { useQuery: () => ({ data: undefined }) } },
    user: { getSsoStatus: { useQuery: () => ({ data: ssoStatus.data }) } },
    governance: {
      recordWorkspaceView: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
  },
}));

beforeEach(() => {
  ssoStatus.data = undefined;
});

afterEach(() => cleanup());

function renderBody({ signOut = vi.fn() }: { signOut?: () => void } = {}) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <WithStubNavigationHost
        readings={{
          pathname: "/acme",
          currentUserId: "user_1",
          organization: { id: "org_1", name: "Acme", teams: [] },
          organizationRole: "ADMIN",
        }}
        actions={{ signOut }}
      >
        <ShellPageBody>
          <p>Project content</p>
        </ShellPageBody>
      </WithStubNavigationHost>
    </ChakraProvider>,
  );
}

describe("given the member still needs to switch to single sign-on", () => {
  beforeEach(() => {
    ssoStatus.data = { pendingSsoSetup: true };
  });

  /** @scenario A member still on the wrong sign-in is told to sign out and use their work email */
  it("tells them to sign out and offers a sign-out action, with no link to settings", () => {
    const signOut = vi.fn();
    const { container } = renderBody({ signOut });

    expect(screen.getByText("Sign in with your organization's single sign-on")).toBeInTheDocument();
    expect(
      screen.getByText(/Sign out, then sign in again by entering your work/),
    ).toBeInTheDocument();
    expect(container.querySelector('a[href^="/settings/"]')).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(signOut).toHaveBeenCalled();
  });
});

describe("given the member already satisfies single sign-on", () => {
  beforeEach(() => {
    ssoStatus.data = { pendingSsoSetup: false };
  });

  /** @scenario A member who already signs in through single sign-on is not asked to link again */
  it("renders no banner", () => {
    renderBody();

    expect(screen.queryByText("Sign in with your organization's single sign-on")).toBeNull();
  });
});
