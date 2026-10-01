/**
 * @vitest-environment jsdom
 *
 * specs/licensing/license-page-styling.feature: what the License page tells an admin,
 * from the status it is given.
 */

import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import type { LicenseStatus } from "@langwatch/enterprise-licensing-contract";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { LicensingHostApi, LicensingHostProvider } from "../../../model/licensing-host.ts";
import { LicenseDetailsCard } from "../../elements/license-details-card.tsx";
import { LicenseLoadError } from "../../elements/license-load-error.tsx";
import { NoLicenseCard } from "../no-license-card.tsx";

class TestHost extends LicensingHostApi {
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
    return undefined;
  }
  refreshPlanDerivedState() {}
  succeeded() {}
  failed() {}
  canManageOrganization() {
    return true;
  }
  describeFailure({ fallbackTitle }: { fallbackTitle: string }) {
    return fallbackTitle;
  }
}

const Wrapper = ({ children }: { children: ReactNode }) => (
  <LicensingHostProvider value={new TestHost()}>{children}</LicensingHostProvider>
);

const counts = {
  currentMembers: 4,
  maxMembers: 100,
  currentMembersLite: 0,
  maxMembersLite: 50,
  currentMessagesPerMonth: 0,
  maxMessagesPerMonth: 1_000_000,
};

const valid: LicenseStatus = {
  hasLicense: true,
  valid: true,
  connected: false,
  plan: "ENTERPRISE",
  planName: "Enterprise",
  expiresAt: "2099-09-30T00:00:00Z",
  organizationName: "Acme Corp",
  ...counts,
};

type InstalledLicense = Extract<LicenseStatus, { hasLicense: true }>;

const renderCard = (status: InstalledLicense) =>
  renderWithDesignSystem(
    <Wrapper>
      <LicenseDetailsCard status={status} onRemove={vi.fn()} isRemoving={false} />
    </Wrapper>,
  );

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

afterEach(() => cleanup());

describe("the License page", () => {
  describe("given a valid license", () => {
    /** @scenario A valid license shows its plan, seats, expiry and holder */
    it("shows the plan, seats against seats bought, expiry and holder", () => {
      renderCard(valid);

      expect(within(screen.getByTestId("license-plan")).getByText("Enterprise")).toBeDefined();
      expect(within(screen.getByTestId("license-seats")).getByText("4 / 100")).toBeDefined();
      expect(within(screen.getByTestId("license-expires")).getByText(/2099/)).toBeDefined();
      expect(within(screen.getByTestId("license-holder")).getByText("Acme Corp")).toBeDefined();
      expect(screen.getByText("Valid")).toBeDefined();
    });

    /** @scenario Seats in use are drawn against the seats bought */
    it("fills the seat meter with the share of seats in use", () => {
      renderCard(valid);

      const fill = screen.getByTestId("license-seats-meter").firstElementChild;
      expect(fill?.getAttribute("data-fill-ratio")).toBe("0.04");
    });

    /** @scenario A license can be removed from the page */
    it("offers to remove the license", () => {
      renderCard(valid);

      expect(screen.getByTestId("license-remove")).toBeDefined();
    });
  });

  describe("given a license whose seats are unlimited", () => {
    /** @scenario Unlimited seats are not drawn as a meter */
    it("says Unlimited and draws no meter", () => {
      renderCard({ ...valid, maxMembers: 1_000_000 });

      expect(within(screen.getByTestId("license-seats")).getByText(/Unlimited/)).toBeDefined();
      expect(screen.queryByTestId("license-seats-meter")).toBeNull();
    });
  });

  describe("given a license file that cannot be read", () => {
    /** @scenario An unreadable license is named and can be removed */
    it("says it is corrupted and still offers removal", () => {
      renderCard({ hasLicense: true, valid: false, corrupted: true });

      expect(screen.getByText("Corrupted")).toBeDefined();
      expect(screen.getByText(/corrupted and cannot be read/i)).toBeDefined();
      expect(screen.getByTestId("license-remove")).toBeDefined();
    });
  });

  describe("given the status could not be read", () => {
    /** @scenario The page offers a retry when the status cannot be read */
    it("offers a retry and no activation form", () => {
      renderWithDesignSystem(
        <Wrapper>
          <LicenseLoadError onRetry={vi.fn()} />
        </Wrapper>,
      );

      expect(screen.getByText("Unable to load license")).toBeDefined();
      expect(screen.getByRole("button", { name: "Retry" })).toBeDefined();
    });
  });
});

describe("the no-license card", () => {
  const renderCard = (overrides?: { activationCode?: string; onCodeActivate?: () => void }) =>
    renderWithDesignSystem(
      <Wrapper>
        <NoLicenseCard
          licenseKey=""
          onLicenseKeyChange={vi.fn()}
          onActivate={vi.fn()}
          activationCode={overrides?.activationCode ?? ""}
          onActivationCodeChange={vi.fn()}
          onCodeActivate={overrides?.onCodeActivate ?? vi.fn()}
          isActivating={false}
        />
      </Wrapper>,
    );

  /** @scenario Without a license the page offers three ways to activate one */
  it("offers an activation code, a license file and a license key", () => {
    renderCard();

    expect(screen.getByText("No license installed")).toBeDefined();
    expect(screen.getByText("Open source")).toBeDefined();
    expect(screen.getAllByText("Activation code").length).toBeGreaterThan(0);
    expect(screen.getByText("License file")).toBeDefined();
    expect(screen.getAllByText("License key").length).toBeGreaterThan(0);
  });

  /** @scenario Activation waits until something is entered */
  it("keeps activate disabled until there is something to activate", () => {
    renderCard();

    expect((screen.getByTestId("license-activate") as HTMLButtonElement).disabled).toBe(true);
  });

  /** @scenario Activating with a code hands the code on */
  it("activates the entered code", () => {
    const onCodeActivate = vi.fn();
    renderCard({ activationCode: "LW-AAAA-BBBB-CCCC-DDDD", onCodeActivate });

    fireEvent.click(screen.getByTestId("license-activate"));

    expect(onCodeActivate).toHaveBeenCalledTimes(1);
  });

  /** @scenario Switching to a license key shows the key field */
  it("shows the key field once the license key method is chosen", async () => {
    renderCard();

    await userEvent.click(screen.getByText("License key"));

    expect(screen.getByTestId("license-key-input")).toBeDefined();
  });
});
