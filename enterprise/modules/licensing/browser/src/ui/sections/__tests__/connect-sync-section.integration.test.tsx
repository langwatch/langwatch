/**
 * @vitest-environment jsdom
 * @see specs/self-hosting/connected-services/license-sync.feature
 *
 * What Settings, Connect says about the daily license sync: when it last
 * succeeded, and why it is failing.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
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

function renderSync(sync: ConnectEnabledStatus["sync"]) {
  const status: ConnectEnabledStatus = {
    deployment: "on",
    gatewayHost: "gateway.langwatch.ai",
    licensed: true,
    enabledServices: [],
    entitledServices: null,
    usage: null,
    refusal: null,
    sync,
  };
  render(
    <ChakraProvider value={defaultSystem}>
      <LicensingHostProvider value={new TestHost()}>
        <ConnectSyncSection status={status} />
      </LicensingHostProvider>
    </ChakraProvider>,
  );
}

afterEach(cleanup);

describe("the license sync section", () => {
  describe("given an install whose license syncs", () => {
    it("says when sync last succeeded", () => {
      renderSync({ lastSyncAt: "2026-09-19T06:00:00.000Z", lastError: null });

      expect(screen.getByText("September 19, 2026")).toBeDefined();
      expect(screen.queryByTestId("connect-sync-failure")).toBeNull();
    });
  });

  describe("given a sync that has been failing for a day", () => {
    /** @scenario "A failing sync is visible from the first failure" */
    it("shows when it last succeeded and why it is failing", () => {
      renderSync({
        lastSyncAt: "2026-09-18T06:00:00.000Z",
        lastError: { code: "connect_unreachable" },
      });

      expect(screen.getByText("September 18, 2026")).toBeDefined();
      expect(screen.getByTestId("connect-sync-failure").textContent).toBe(
        "LangWatch could not be reached",
      );
    });
  });

  describe("given an install that has not synced yet", () => {
    it("says so rather than showing an empty date", () => {
      renderSync({ lastSyncAt: null, lastError: null });

      expect(screen.getByText("It has not synced yet")).toBeDefined();
      expect(screen.queryByTestId("connect-sync-failure")).toBeNull();
    });
  });
});
