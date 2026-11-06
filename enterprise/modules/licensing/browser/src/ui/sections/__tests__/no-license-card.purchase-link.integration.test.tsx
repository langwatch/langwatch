/**
 * @vitest-environment jsdom
 *
 * specs/licensing/self-serving-license-purchase.feature: the "Purchase license"
 * button follows STRIPE_LICENSE_PAYMENT_LINK_URL and is absent without it.
 */

import { DesignSystemProvider } from "@langwatch/design-system/provider";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { LicensingHostApi, LicensingHostProvider } from "../../../model/licensing-host.ts";
import { NoLicenseCard } from "../no-license-card.tsx";

class TestHost extends LicensingHostApi {
  constructor(private readonly purchaseUrl: string | undefined) {
    super();
  }
  organizationId() {
    return "org-1";
  }
  isSaaS() {
    return false;
  }
  isDeploymentSettled() {
    return true;
  }
  licensePurchaseUrl() {
    return this.purchaseUrl;
  }
  refreshPlanDerivedState() {}
  succeeded() {}
  warned() {}
  informed() {}
  failed() {}
  canManageOrganization() {
    return true;
  }
  describeFailure({ fallbackTitle }: { fallbackTitle: string }) {
    return fallbackTitle;
  }
}

const noop = () => {};

const renderCard = ({ purchaseUrl }: { purchaseUrl: string | undefined }) =>
  render(
    <DesignSystemProvider forcedTheme="light">
      <LicensingHostProvider value={new TestHost(purchaseUrl)}>
        <NoLicenseCard
          licenseKey=""
          onLicenseKeyChange={noop}
          onActivate={noop}
          activationCode=""
          onActivationCodeChange={noop}
          onCodeActivate={noop}
          isActivating={false}
          canManage
        />
      </LicensingHostProvider>
    </DesignSystemProvider>,
  );

/** The first render loads the design system, which outlasts the default 5 s on a busy machine. */
const RENDER_TIMEOUT_MS = 30_000;

describe("NoLicenseCard purchase link", () => {
  beforeAll(() => {
    // jsdom has no ResizeObserver, which the segmented control measures with.
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => {
    cleanup();
  });

  describe("when the payment link URL is configured", () => {
    /** @scenario "Purchase button uses configured payment link URL" */
    it(
      "links the Purchase license button to it",
      () => {
        renderCard({ purchaseUrl: "https://buy.stripe.com/test123" });

        expect(screen.getByRole("link", { name: /Purchase license/ })).toHaveAttribute(
          "href",
          "https://buy.stripe.com/test123",
        );
      },
      RENDER_TIMEOUT_MS,
    );
  });

  describe("when the payment link URL is not configured", () => {
    /** @scenario "Purchase button hidden when payment link URL is not configured" */
    it(
      "shows no Purchase license button",
      () => {
        renderCard({ purchaseUrl: undefined });

        expect(screen.getByTestId("license-activate")).toBeInTheDocument();
        expect(screen.queryByText(/Purchase license/)).toBeNull();
      },
      RENDER_TIMEOUT_MS,
    );
  });
});
