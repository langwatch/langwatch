import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  BrowserUiDocumentTitle,
  UiHostServicesContextProvider,
  UNAVAILABLE_UI_FEEDBACK,
  UNAVAILABLE_UI_SESSION,
  UiNavigation,
  UiRoute,
  type UiDeployment,
  type UiHostServices,
} from "../capabilities.ts";
import { EnterpriseLock, LICENSE_SETTINGS_HREF, PLANS_HREF } from "../enterprise-lock.tsx";

class InertNavigation extends UiNavigation {
  navigate(): void {}
  replace(): void {}
  back(): void {}
}

class EmptyRoute extends UiRoute {
  reading() {
    return { params: {}, query: {} };
  }
  setQuery(): void {}
}

function deployment(isSaaS: boolean): UiDeployment {
  return {
    isDevelopment: false,
    isSaaS,
    appBaseUrl: "http://localhost",
    hasNlpService: true,
    hasLangevals: true,
    hasEmailProvider: false,
    hasCloudOps: false,
  };
}

function renderLock({
  isSaaS,
  canManage,
  canSeePlans,
}: {
  isSaaS: boolean;
  canManage: boolean;
  canSeePlans?: boolean;
}) {
  const hostServices: UiHostServices = {
    documentTitle: BrowserUiDocumentTitle.create(),
    feedback: UNAVAILABLE_UI_FEEDBACK,
    navigation: new InertNavigation(),
    route: new EmptyRoute(),
    session: UNAVAILABLE_UI_SESSION,
    deployment: deployment(isSaaS),
  };
  render(
    <DesignSystemProvider forcedTheme="light">
      <UiHostServicesContextProvider value={hostServices}>
        <EnterpriseLock
          feature="Audit log"
          description="See who changed what across your organization, and when."
          canManage={canManage}
          canSeePlans={canSeePlans}
          data-testid="lock"
        />
      </UiHostServicesContextProvider>
    </DesignSystemProvider>,
  );
}

describe("EnterpriseLock", () => {
  describe("given a self-hosted install", () => {
    /** @scenario "An organization admin on a self-hosted install is offered to activate or get a license" */
    it("offers an admin to activate or get a license, both on the License page", () => {
      renderLock({ isSaaS: false, canManage: true });
      expect(screen.getByText("Audit log is part of LangWatch Enterprise")).toBeInTheDocument();
      expect(
        screen.getByText("See who changed what across your organization, and when."),
      ).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Activate a license" })).toHaveAttribute(
        "href",
        LICENSE_SETTINGS_HREF,
      );
      expect(screen.getByRole("link", { name: "Get a license" })).toHaveAttribute(
        "href",
        LICENSE_SETTINGS_HREF,
      );
      expect(screen.queryByRole("link", { name: "See plans" })).toBeNull();
    });

    /** @scenario "A member on a self-hosted install is told to ask an admin" */
    it("tells a member to ask an admin and offers no button", () => {
      renderLock({ isSaaS: false, canManage: false });
      expect(
        screen.getByText(/Ask an organization admin to activate a license\./),
      ).toBeInTheDocument();
      expect(screen.queryByRole("link")).toBeNull();
      expect(screen.queryByRole("button")).toBeNull();
    });
  });

  describe("given Cloud", () => {
    /** @scenario "An organization admin on Cloud is offered the plans" */
    it("keeps offering the plans", () => {
      renderLock({ isSaaS: true, canManage: true });
      expect(screen.getByText("Audit log is included in Enterprise")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "See plans" })).toHaveAttribute("href", PLANS_HREF);
    });

    /** @scenario "A member on Cloud who may not open the plans page is told to ask an admin" */
    it("tells a member who may not open the plans page to ask an admin", () => {
      renderLock({ isSaaS: true, canManage: false, canSeePlans: false });
      expect(
        screen.getByText(/Ask an organization admin about upgrading your plan\./),
      ).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "See plans" })).toBeNull();
    });
  });
});
