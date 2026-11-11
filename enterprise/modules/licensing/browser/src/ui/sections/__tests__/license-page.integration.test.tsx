/**
 * @vitest-environment jsdom
 *
 * specs/licensing/license-page-styling.feature: what the License page tells an admin,
 * from the status it is given.
 */

import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { DEFAULT_MEMBERS_LITE, type LicenseStatus } from "@langwatch/enterprise-licensing-contract";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { lastSyncedText, syncLineOf } from "../../../model/connect-sync.ts";
import { LicensingHostApi, LicensingHostProvider } from "../../../model/licensing-host.ts";
import {
  type LicenseHostedState,
  LicenseDetailsCard,
} from "../../elements/license-details-card.tsx";
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
      <LicenseDetailsCard status={status} onRemove={vi.fn()} isRemoving={false} canManage />
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

    /** @scenario "The expiry date fits its tile and keeps the full date on hover" */
    it("shows the expiry with a short month and the full date as its title", () => {
      renderCard(valid);

      const figure = within(screen.getByTestId("license-expires")).getByTitle("September 30, 2099");
      expect(figure.textContent).toBe("Sep 30, 2099");
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

  describe("given a license with a finite Lite seat limit", () => {
    /** @scenario "A finite Lite seat limit is shown next to the seats" */
    it("shows the Lite seats in use against the limit, right after the seats tile", () => {
      renderCard({ ...valid, currentMembersLite: 3, maxMembersLite: 50 });

      const tile = screen.getByTestId("license-lite-seats");
      expect(within(tile).getByText("Lite seats")).toBeDefined();
      expect(within(tile).getByText("3 / 50")).toBeDefined();
      expect(screen.getByTestId("license-seats").nextElementSibling).toBe(tile);
    });
  });

  describe("given a license whose Lite seats are unlimited", () => {
    /** @scenario "Unlimited Lite seats are not shown" */
    it("shows no Lite seats tile", () => {
      renderCard({ ...valid, maxMembersLite: Number.MAX_SAFE_INTEGER });

      expect(screen.queryByTestId("license-lite-seats")).toBeNull();
      expect(screen.getByTestId("license-seats")).toBeDefined();
    });
  });

  describe("given a license that states no Lite limit", () => {
    /** @scenario "A license that states no Lite limit shows the one Lite seat it enforces" */
    it("shows the one Lite seat the default allows", () => {
      renderCard({ ...valid, currentMembersLite: 0, maxMembersLite: DEFAULT_MEMBERS_LITE });

      expect(within(screen.getByTestId("license-lite-seats")).getByText("0 / 1")).toBeDefined();
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
  const renderCard = (overrides?: {
    activationCode?: string;
    onCodeActivate?: () => void;
    canManage?: boolean;
  }) =>
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
          canManage={overrides?.canManage ?? true}
        />
      </Wrapper>,
    );

  /** @scenario Without a license the page offers two cards, one for a code and one for buying */
  it("offers a card for a code and a card for buying a license", () => {
    renderCard();

    expect(screen.getByText("No license installed")).toBeDefined();
    const haveCode = within(screen.getByTestId("license-have-code"));
    expect(haveCode.getByText("I have an activation code")).toBeDefined();
    expect(haveCode.getByTestId("license-activation-code")).toBeDefined();
    expect(haveCode.getByTestId("license-activate")).toBeDefined();
    const needLicense = within(screen.getByTestId("license-need-license"));
    expect(needLicense.getByText("I need a license")).toBeDefined();
    expect(
      needLicense.getByText("You get an activation code when you buy a license."),
    ).toBeDefined();
    expect(needLicense.getByRole("link", { name: /Talk to sales/ })).toBeDefined();
    expect(screen.queryByText(/sent with your order/)).toBeNull();
  });

  /** @scenario Without a license the page offers three ways to activate one */
  it("offers an activation code, a license file and a license key inside the code card", () => {
    renderCard();

    const haveCode = within(screen.getByTestId("license-have-code"));
    expect(haveCode.getAllByText("Activation code").length).toBeGreaterThan(0);
    expect(haveCode.getByText("License file")).toBeDefined();
    expect(haveCode.getAllByText("License key").length).toBeGreaterThan(0);
  });

  /** @scenario Activation waits until something is entered */
  it("keeps activate disabled and says why until there is something to activate", () => {
    renderCard();

    expect((screen.getByTestId("license-activate") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("license-activate-waiting").textContent).toBe(
      "Enter an activation code to activate.",
    );
  });

  /** @scenario The reason activation waits follows the chosen form */
  it("names what is missing for the chosen form", async () => {
    renderCard();

    await userEvent.click(screen.getByText("License key"));
    expect(screen.getByTestId("license-activate-waiting").textContent).toBe(
      "Paste a license key to activate.",
    );
    await userEvent.click(screen.getByText("License file"));
    expect(screen.getByTestId("license-activate-waiting").textContent).toBe(
      "Choose a license file to activate.",
    );
  });

  /** @scenario The reason disappears once something is entered */
  it("enables activate and drops the reason once a code is entered", () => {
    renderCard({ activationCode: "LW-AAAA-BBBB-CCCC-DDDD" });

    expect((screen.getByTestId("license-activate") as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByTestId("license-activate-waiting")).toBeNull();
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

  /** @scenario A member who cannot manage the organization is told who can activate */
  it("tells a member an organization admin can activate, with no form", () => {
    renderCard({ canManage: false });

    expect(screen.getByText("An organization admin can activate a license.")).toBeDefined();
    expect(screen.queryByTestId("license-activation-code")).toBeNull();
    expect(screen.queryByTestId("license-activate")).toBeNull();
  });
});

describe("the sync line and a revocation on the License page", () => {
  const connected: InstalledLicense = { ...valid, connected: true };
  const renderConnected = (hosted: LicenseHostedState | undefined) =>
    renderWithDesignSystem(
      <Wrapper>
        <LicenseDetailsCard
          status={connected}
          onRemove={vi.fn()}
          isRemoving={false}
          canManage
          hosted={hosted}
        />
      </Wrapper>,
    );
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60_000).toISOString();

  /** @scenario A connected license that has synced says when */
  it("says when the license last synced", () => {
    renderConnected({ syncText: lastSyncedText(fiveMinutesAgo), isRevoked: false });

    expect(screen.getByTestId("license-sync-line").textContent).toBe("Last synced 5 minutes ago");
  });

  /** @scenario A connected license that has never synced says so */
  it("says Not synced yet and never Connected", () => {
    renderConnected({
      syncText: syncLineOf({ lastSyncAt: null, lastError: null }).text,
      isRevoked: false,
    });

    expect(screen.getByTestId("license-sync-line").textContent).toBe("Not synced yet");
    expect(screen.queryByText(/Connected to LangWatch/)).toBeNull();
  });

  /** @scenario A failed sync is named on the License page and never reads as connected */
  it("leads with the failure, names why and keeps the last success", () => {
    const line = syncLineOf({
      lastSyncAt: fiveMinutesAgo,
      lastError: { code: "connect_unreachable" },
    });
    renderConnected({
      syncText: line.text,
      syncFailure: "Hosted services were not reached",
      isRevoked: false,
    });

    expect(screen.getByTestId("license-sync-line").textContent).toBe(
      "Last sync failed. Last synced 5 minutes ago.",
    );
    expect(screen.getByTestId("license-sync-failure").textContent).toBe(
      "Hosted services were not reached",
    );
    expect(screen.queryByText(/Connected/)).toBeNull();
  });

  /** @scenario A revoked license is not called valid */
  it("says LangWatch revoked it and does not call it valid", () => {
    renderConnected({ syncText: "Last synced 5 minutes ago", isRevoked: true });

    expect(screen.getByTestId("license-status-sentence").textContent).toBe(
      "Revoked by LangWatch: hosted services are off",
    );
    expect(screen.getByText("Revoked")).toBeDefined();
    expect(screen.queryByText("Valid")).toBeNull();
    expect(screen.queryByText(/signature checks out/)).toBeNull();
  });
});
