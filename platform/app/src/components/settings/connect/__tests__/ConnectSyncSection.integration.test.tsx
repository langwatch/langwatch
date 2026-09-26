/**
 * @vitest-environment jsdom
 *
 * What Settings, Connect says about the daily license sync.
 *
 * An admin who opens this page is usually here because something stopped:
 * judging went quiet, or a seat change has not arrived. The page has to
 * answer when sync last succeeded and why it is failing.
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

afterEach(cleanup);

describe("given an install whose license syncs", () => {
  describe("when an admin opens Settings, Connect", () => {
    it("says when sync last succeeded", () => {
      renderSync({
        lastSyncAt: "2026-09-19T06:00:00.000Z",
        lastError: null,
      });

      expect(screen.getByText("September 19, 2026")).toBeInTheDocument();
      expect(screen.queryByTestId("connect-sync-failure")).toBeNull();
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
      });

      expect(screen.getByText("September 18, 2026")).toBeInTheDocument();
      expect(
        screen.getByText("LangWatch could not be reached"),
      ).toBeInTheDocument();
    });
  });
});

describe("given an install that has not synced yet", () => {
  describe("when an admin opens Settings, Connect", () => {
    it("says so rather than showing an empty date", () => {
      renderSync({ lastSyncAt: null, lastError: null });

      expect(screen.getByText("It has not synced yet")).toBeInTheDocument();
      expect(screen.queryByTestId("connect-sync-failure")).toBeNull();
    });
  });
});
