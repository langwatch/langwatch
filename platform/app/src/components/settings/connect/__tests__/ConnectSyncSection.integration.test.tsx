/**
 * @vitest-environment jsdom
 *
 * What Settings, Connect says about the daily license sync.
 *
 * An admin who opens this page is usually here because something stopped: a
 * seat was refused, or judging went quiet. The page has to answer when sync
 * last succeeded, why it is failing, and what the seats look like meanwhile.
 *
 * Spec: specs/self-hosting/connected-services/license-sync.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ConnectSyncSection } from "../ConnectSyncSection";
import type { ConnectEnabledView } from "../connectStatus";

type SyncView = ConnectEnabledView["sync"];

function statusWith(sync: SyncView): ConnectEnabledView {
  return {
    deployment: "on",
    gatewayHost: "gateway.langwatch.ai",
    licensed: true,
    enabledServices: [],
    entitledServices: null,
    usage: null,
    refusal: null,
    sync,
  } as ConnectEnabledView;
}

function renderSync(sync: SyncView) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <ConnectSyncSection status={statusWith(sync)} />
    </ChakraProvider>,
  );
}

const FRESH_LEASE = {
  seatOverageAllowance: 5,
  warnAfter: "2026-10-03T12:00:00.000Z",
  validUntil: "2026-10-19T12:00:00.000Z",
  state: "fresh" as const,
};

afterEach(cleanup);

describe("given an install whose license syncs", () => {
  describe("when an admin opens Settings, Connect", () => {
    it("says when sync last succeeded and how many seats it may go over by", () => {
      renderSync({
        lastSyncAt: "2026-09-19T06:00:00.000Z",
        lastError: null,
        lease: FRESH_LEASE,
      });

      expect(screen.getByText("September 19, 2026")).toBeInTheDocument();
      expect(screen.getByText("5 extra")).toBeInTheDocument();
    });
  });
});

describe("given a sync that has been failing for a day", () => {
  describe("when an admin opens Settings, Connect", () => {
    /** @scenario "A failing sync is visible from the first failure" */
    it("shows when it last succeeded and why it is failing", () => {
      renderSync({
        lastSyncAt: "2026-09-18T06:00:00.000Z",
        lastError: { code: "connect_unreachable" },
        lease: FRESH_LEASE,
      });

      expect(screen.getByText("September 18, 2026")).toBeInTheDocument();
      expect(
        screen.getByText("LangWatch could not be reached"),
      ).toBeInTheDocument();
    });
  });
});

describe("given a lease past the day admins are warned", () => {
  describe("when an admin opens Settings, Connect", () => {
    /** @scenario "Between day 14 and day 30 the allowance is kept and admins are warned" */
    it("names the day the extra seats will be withdrawn", () => {
      renderSync({
        lastSyncAt: "2026-09-05T06:00:00.000Z",
        lastError: { code: "connect_unreachable" },
        lease: { ...FRESH_LEASE, state: "warning" },
      });

      expect(screen.getByTestId("connect-lease-warning").textContent).toContain(
        "October 19, 2026",
      );
      expect(screen.getByText("5 extra")).toBeInTheDocument();
    });
  });
});

describe("given a lease that ran out", () => {
  describe("when an admin opens Settings, Connect", () => {
    /** @scenario "After day 30 the allowance is withdrawn" */
    it("says the extra seats are gone and what brings them back", () => {
      renderSync({
        lastSyncAt: "2026-08-19T06:00:00.000Z",
        lastError: { code: "connect_unreachable" },
        lease: { ...FRESH_LEASE, state: "expired" },
      });

      expect(screen.getByText("None, the licensed count")).toBeInTheDocument();
      expect(screen.getByTestId("connect-lease-expired").textContent).toContain(
        "next successful sync",
      );
    });
  });
});

describe("given an install that has not synced yet", () => {
  describe("when an admin opens Settings, Connect", () => {
    it("says so rather than showing an empty date", () => {
      renderSync({ lastSyncAt: null, lastError: null, lease: null });

      expect(screen.getByText("It has not synced yet")).toBeInTheDocument();
      expect(screen.queryByTestId("connect-sync-failure")).toBeNull();
    });
  });
});
