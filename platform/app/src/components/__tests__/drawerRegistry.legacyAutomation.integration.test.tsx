/**
 * @vitest-environment jsdom
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { OrganizationUserRole } from "@prisma/client";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CurrentDrawer } from "../CurrentDrawer";

/**
 * The URL a caller kept from an old API response or an old automation email.
 * Everything below the router is real: the registry, the name lookup, and the
 * lazy import behind it. Only the authoring drawer's own body is stubbed, since
 * what is under test is which drawer the name reaches, not what it renders.
 */
const LEGACY_QUERY = {
  "drawer.open": "editAutomationFilter",
  "drawer.automationId": "trigger-1",
};

let mockQuery: Record<string, string> = {};

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    query: mockQuery,
    asPath: `?${new URLSearchParams(mockQuery).toString()}`,
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

vi.mock("../../hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: vi.fn(() => ({
    organizationRole: OrganizationUserRole.ADMIN,
  })),
}));

vi.mock("../../stores/upgradeModalStore", () => ({
  useUpgradeModalStore: Object.assign(
    vi.fn(() => ({ openLiteMemberRestriction: vi.fn() })),
    {
      getState: () => ({
        openLiteMemberRestriction: vi.fn(),
        close: vi.fn(),
      }),
    },
  ),
}));

vi.mock("~/features/automations/AutomationDrawer", () => ({
  AutomationDrawer: () => <div data-testid="automation-drawer" />,
}));

describe("<CurrentDrawer/>", () => {
  beforeEach(() => {
    mockQuery = { ...LEGACY_QUERY };
  });

  afterEach(() => {
    cleanup();
  });

  describe("given a link that names the superseded automation drawer", () => {
    describe("when the app resolves that URL", () => {
      /** @scenario "A link issued before the drawer changed still opens the automation" */
      it("opens the authoring drawer", async () => {
        // The REST `platformUrl` field and the automation emails handed this
        // name out for as long as it was the drawer they opened, so those links
        // sit in inboxes and in stored API responses. They have to keep
        // resolving, and they have to resolve to the drawer that can edit a
        // query condition, which the one they used to open never could.
        render(
          <ChakraProvider value={defaultSystem}>
            <CurrentDrawer />
          </ChakraProvider>,
        );

        expect(
          await screen.findByTestId("automation-drawer"),
        ).toBeInTheDocument();
      });
    });
  });
});
