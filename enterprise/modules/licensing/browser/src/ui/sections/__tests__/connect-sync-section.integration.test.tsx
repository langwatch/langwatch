/**
 * @vitest-environment jsdom
 * @see specs/self-hosting/connected-services/license-sync.feature
 *
 * What Settings, Connect says about the daily license sync: when it last
 * succeeded, and why it is failing.
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  LicensingHostApi,
  LicensingHostProvider,
  type LicensingFailureNotice,
} from "../../../model/licensing-host.ts";
import type { ConnectEnabledStatus } from "../connect-status.ts";
import { ConnectSyncSection } from "../connect-sync-section.tsx";

/** The shell resolves a code to its customer copy; this host knows the one code in play. */
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
  describeFailure({ error, fallbackTitle }: LicensingFailureNotice) {
    return JSON.stringify(error).includes("connect_unreachable")
      ? "LangWatch could not be reached"
      : fallbackTitle;
  }
}

function renderSync(
  sync: ConnectEnabledStatus["sync"],
  refusal: ConnectEnabledStatus["refusal"] = null,
) {
  const status: ConnectEnabledStatus = {
    deployment: "on",
    gatewayHost: "gateway.langwatch.ai",
    licensed: true,
    enabledServices: [],
    entitledServices: null,
    usage: null,
    refusal,
    isUsageUnavailable: false,
    sync,
  };
  renderWithDesignSystem(
    <LicensingHostProvider value={new TestHost()}>
      <ConnectSyncSection status={status} />
    </LicensingHostProvider>,
  );
}

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

afterEach(cleanup);

describe("the license sync section", () => {
  describe("given an install whose license syncs", () => {
    /** @scenario "The sync line uses the same words on the Connect and License pages" */
    it("says Last synced and how long ago", () => {
      renderSync({ lastSyncAt: minutesAgo(5), lastError: null });

      expect(screen.getByTestId("connect-sync-line").textContent).toBe("Last synced 5 minutes ago");
      expect(screen.queryByTestId("connect-sync-failure")).toBeNull();
    });
  });

  describe("given a sync that has been failing", () => {
    /** @scenario "A failing sync is visible from the first failure" */
    it("shows when it last succeeded and why it is failing", () => {
      renderSync({ lastSyncAt: minutesAgo(5), lastError: { code: "connect_unreachable" } });

      expect(screen.getByTestId("connect-sync-line").textContent).toBe(
        "Last sync failed. Last synced 5 minutes ago.",
      );
      expect(screen.getByTestId("connect-sync-failure").textContent).toBe(
        "LangWatch could not be reached",
      );
    });
  });

  describe("given an install that has not synced yet", () => {
    /** @scenario "The sync line uses the same words on the Connect and License pages" */
    it("says Not synced yet", () => {
      renderSync({ lastSyncAt: null, lastError: null });

      expect(screen.getByTestId("connect-sync-line").textContent).toBe("Not synced yet");
      expect(screen.queryByTestId("connect-sync-failure")).toBeNull();
    });
  });

  describe("given a sync failure that is also the page's refusal", () => {
    /** @scenario "A failure that is already the page's refusal is not shown twice" */
    it("leaves the reason to the refusal banner", () => {
      renderSync(
        { lastSyncAt: null, lastError: { code: "connect_license_revoked" } },
        { code: "connect_license_revoked" },
      );

      expect(screen.queryByTestId("connect-sync-failure")).toBeNull();
      expect(screen.getByTestId("connect-sync-line").textContent).toBe(
        "Last sync failed. Not synced yet.",
      );
    });
  });
});
