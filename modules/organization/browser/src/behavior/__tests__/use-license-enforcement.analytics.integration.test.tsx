/**
 * @vitest-environment jsdom
 * The upgrade modal opening is a moment worth counting, and the module that
 * opens it is the one that names the event.
 * @see specs/licensing/enforcement-members.feature
 */
import { UiAnalytics, type UiAnalyticsEvent } from "@langwatch/browser-host/analytics";
import { useUpgradeModalStore } from "@langwatch/browser-host/upgrade-modal-store";
import "@testing-library/jest-dom/vitest";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithOrganizationHost } from "../../testing.tsx";
import { useLicenseEnforcement } from "../use-license-enforcement.ts";

vi.mock("../organization-api.ts", () => {
  const answers: Record<string, unknown> = {
    "licenseEnforcement.checkLimit": { allowed: false, current: 5, max: 5 },
  };
  const endpoint = (path: string) => ({
    useQuery: () => ({ data: answers[path], isLoading: false, refetch: vi.fn() }),
    useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
    invalidate: vi.fn(),
  });
  const namespace = (prefix: string): Record<string, unknown> =>
    new Proxy(endpoint(prefix) as Record<string, unknown>, {
      get: (target: Record<string, unknown>, name) => {
        if (name in target) return target[name as string];
        if (typeof name !== "string") return void 0;
        return namespace(prefix ? `${prefix}.${name}` : name);
      },
    }) as Record<string, unknown>;
  const root = namespace("");
  root.useUtils = () => root;
  return { api: root };
});

class RecordingUiAnalytics extends UiAnalytics {
  readonly tracked: UiAnalyticsEvent[] = [];
  track(event: UiAnalyticsEvent): void {
    this.tracked.push(event);
  }
  identify(): void {}
  group(): void {}
  reset(): void {}
}

function InviteAnother() {
  const { checkAndProceed } = useLicenseEnforcement("members");
  return (
    <button type="button" onClick={() => checkAndProceed(() => void 0)}>
      Invite another
    </button>
  );
}

describe("license enforcement", () => {
  afterEach(() => {
    cleanup();
    useUpgradeModalStore.getState().close();
  });

  describe("when the seat limit is already reached", () => {
    /** @scenario "The upgrade modal opening is counted with what stopped the action" */
    it("counts the upgrade modal opening, with the limit that stopped the action", async () => {
      const analytics = new RecordingUiAnalytics();
      renderWithOrganizationHost(<InviteAnother />, void 0, { analytics });

      await userEvent.click(screen.getByText("Invite another"));

      expect(analytics.tracked).toEqual([
        {
          boundary: "organization",
          action: "shown",
          name: "upgrade_modal",
          attributes: { mode: "limit", limitType: "members", current: 5, max: 5 },
        },
      ]);
    });
  });
});
