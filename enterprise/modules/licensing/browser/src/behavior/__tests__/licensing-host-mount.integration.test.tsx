// @vitest-environment jsdom
/**
 * The mount answers the purchase link from the deployment's licence payment URL.
 * Spec: specs/licensing/self-serving-license-purchase.feature
 */
import {
  UiHostServiceUnavailableError,
  UiHostServicesContextProvider,
  UiScope,
  UiSession,
  type UiActiveScope,
  type UiHostServices,
} from "@langwatch/browser-host/capabilities";
import { createUiHostServicesFromHost } from "@langwatch/browser-host/testing";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../licensing-api.ts", () => ({
  licensingApi: { useUtils: () => ({ invalidate: () => Promise.resolve() }) },
}));
vi.mock("../../ui/sections/global-upgrade-modal/global-upgrade-modal.tsx", () => ({
  GlobalUpgradeModal: () => null,
}));

import { useLicensingHost } from "../../model/licensing-host.ts";
import LicensingHostMount, { managesOrganization } from "../licensing-host-mount.tsx";

class TestScope extends UiScope {
  activeScope(): UiActiveScope {
    return { organizationId: "org-1", projectId: "proj-1" };
  }
}

class AdminSession extends UiSession {
  currentUser() {
    return null;
  }

  hasPermission(): boolean {
    return true;
  }

  isSettled(): boolean {
    return true;
  }
}

function capabilitiesWith({ licensePaymentUrl }: { licensePaymentUrl?: string }): UiHostServices {
  return {
    ...createUiHostServicesFromHost(
      { route: () => ({ params: {}, query: {} }), navigate: () => void 0 },
      new AdminSession(),
    ),
    scope: new TestScope(),
    deployment: {
      isDevelopment: false,
      isSaaS: false,
      appBaseUrl: "https://app.langwatch.test",
      hasNlpService: true,
      hasLangevals: true,
      hasEmailProvider: false,
      hasCloudOps: false,
      ...(licensePaymentUrl ? { licensePaymentUrl } : {}),
    },
  };
}

function PurchaseUrlReader() {
  return <span data-testid="url">{useLicensingHost().licensePurchaseUrl() ?? "(none)"}</span>;
}

function renderMount(capabilities: UiHostServices) {
  render(
    <UiHostServicesContextProvider value={capabilities}>
      <LicensingHostMount>
        <PurchaseUrlReader />
      </LicensingHostMount>
    </UiHostServicesContextProvider>,
  );
}

describe("given the licensing host mount", () => {
  afterEach(cleanup);

  describe("when the deployment configures a licence payment link", () => {
    it("answers that link as the purchase URL", () => {
      renderMount(capabilitiesWith({ licensePaymentUrl: "https://buy.stripe.com/test123" }));

      expect(screen.getByTestId("url").textContent).toBe("https://buy.stripe.com/test123");
    });
  });

  describe("when the deployment configures no payment link", () => {
    it("answers no purchase URL", () => {
      renderMount(capabilitiesWith({}));

      expect(screen.getByTestId("url").textContent).toBe("(none)");
    });
  });
});

/** An organization admin whose active project grants nothing at the organization. */
class OrganizationAdminSession extends UiSession {
  currentUser() {
    return null;
  }

  hasPermission(): boolean {
    return false;
  }

  override hasOrganizationPermission(permission: string): boolean {
    return permission === "organization:manage";
  }

  isSettled(): boolean {
    return true;
  }
}

/** A session port that cannot answer at the organization. */
class ScopeOnlySession extends UiSession {
  currentUser() {
    return null;
  }

  hasPermission(permission: string): boolean {
    return permission === "organization:manage";
  }

  override hasOrganizationPermission(): boolean {
    throw new UiHostServiceUnavailableError("session organization permission");
  }

  isSettled(): boolean {
    return true;
  }
}

describe("given who manages the organization", () => {
  describe("when the active project says no but the organization says yes", () => {
    /** @scenario "An organization admin reads as an admin wherever the active project is" */
    it("treats them as an organization admin", () => {
      expect(managesOrganization(new OrganizationAdminSession())).toBe(true);
    });
  });

  describe("when the session cannot answer at the organization", () => {
    /** @scenario "The admin check falls back when the organization cannot answer" */
    it("uses the scope-wide answer", () => {
      expect(managesOrganization(new ScopeOnlySession())).toBe(true);
    });
  });
});
