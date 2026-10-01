// @vitest-environment jsdom
/**
 * The mount answers the purchase link from the deployment's licence payment URL.
 * Spec: specs/licensing/self-serving-license-purchase.feature
 */
import {
  UiCapabilityContextProvider,
  UiScope,
  UiSession,
  type UiActiveScope,
  type UiCapabilities,
} from "@langwatch/browser-host/capabilities";
import { createUiCapabilitiesFromHost } from "@langwatch/browser-host/testing";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../licensing-api.ts", () => ({
  licensingApi: { useUtils: () => ({ invalidate: () => Promise.resolve() }) },
}));
vi.mock("../../ui/sections/global-upgrade-modal/global-upgrade-modal.tsx", () => ({
  GlobalUpgradeModal: () => null,
}));

import { useLicensingHost } from "../../model/licensing-host.ts";
import LicensingHostMount from "../licensing-host-mount.tsx";

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

  featureFlag(): boolean | undefined {
    return false;
  }
}

function capabilitiesWith({ licensePaymentUrl }: { licensePaymentUrl?: string }): UiCapabilities {
  return {
    ...createUiCapabilitiesFromHost(
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

function renderMount(capabilities: UiCapabilities) {
  render(
    <UiCapabilityContextProvider value={capabilities}>
      <LicensingHostMount>
        <PurchaseUrlReader />
      </LicensingHostMount>
    </UiCapabilityContextProvider>,
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
