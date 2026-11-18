/**
 * @vitest-environment jsdom
 * Both Braids pages open whatever `release_braids` says (Alex, 2026-11-18): opened the way the
 * router opens them, through the guard the installed declaration puts in front.
 * @see modules/authz/specs/braids-release-flag.feature
 */

import {
  type UiActor,
  UiHostServiceProvider,
  UiHostServicesContextProvider,
  UiSession,
} from "@langwatch/browser-host/capabilities";
import { UiFlagsService } from "@langwatch/browser-host/feature-flag";
import { createUiHostServicesFromHost } from "@langwatch/browser-host/testing";
import { installedModuleScreens } from "@langwatch/browser/module-screens";
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import type { ReleaseFlagToken } from "@langwatch/module";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { authzWeb } from "../authz.web.ts";

const BRAIDS_PAGES = ["pages/settings/braids", "pages/settings/organization-braids"] as const;
const NOT_FOUND = "This page is not here";

/** A settled reader holding no grant at all, so a page past the flag names what it needs. */
class GrantlessReader extends UiSession {
  currentUser(): UiActor | null {
    return null;
  }

  hasPermission(): boolean {
    return false;
  }

  hasOrganizationPermission(): boolean {
    return false;
  }

  isSettled(): boolean {
    return true;
  }
}

async function openPage({ page, braids }: { page: string; braids: boolean }) {
  const load = installedModuleScreens([authzWeb]).loaders[page];
  if (!load) throw new Error(`authz installs no ${page}`);
  const { default: Page } = await load();
  const flags = new Map([
    [
      UiFlagsService.name,
      { flag: ({ name }: ReleaseFlagToken) => name === "release_braids" && braids },
    ],
  ]);

  return renderWithDesignSystem(
    <UiHostServicesContextProvider
      value={createUiHostServicesFromHost(
        { route: () => ({ params: {}, query: {} }), navigate: () => {} },
        new GrantlessReader(),
      )}
    >
      <UiHostServiceProvider value={flags}>
        <Page />
      </UiHostServiceProvider>
    </UiHostServicesContextProvider>,
  );
}

afterEach(cleanup);

describe("the Braids pages", () => {
  describe("given release_braids is off for the organisation", () => {
    /** @scenario "With release_braids off both Braids pages open read-only" */
    it.each(BRAIDS_PAGES)("opens %s past the flag instead of not-found", async (page) => {
      await openPage({ page, braids: false });

      expect(await screen.findByText(/Missing permission/)).toBeInTheDocument();
      expect(screen.queryByText(NOT_FOUND)).not.toBeInTheDocument();
    });
  });

  describe("given release_braids is on for the organisation", () => {
    /** @scenario "With release_braids on the Braids pages are past the flag" */
    it.each(BRAIDS_PAGES)(
      "asks %s for its permission instead of answering not-found",
      async (page) => {
        await openPage({ page, braids: true });

        expect(await screen.findByText(/Missing permission/)).toBeInTheDocument();
        expect(screen.queryByText(NOT_FOUND)).not.toBeInTheDocument();
      },
    );
  });
});
