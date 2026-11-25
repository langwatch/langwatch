/**
 * @vitest-environment jsdom
 * The upgrade modal opening is a moment worth counting, and the module that
 * opens it is the one that names the event.
 * @see specs/licensing/enforcement-members.feature
 */
import { UiAnalytics, type UiAnalyticsEvent } from "@langwatch/browser-host/analytics";
import "@testing-library/jest-dom/vitest";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithOrganizationHost } from "../../testing.tsx";
import { useLicenseEnforcement } from "../use-license-enforcement.ts";

const REACHED = { allowed: false, current: 5, max: 5 };

const { openUpgradeModal, lent, limit } = vi.hoisted(() => ({
  openUpgradeModal: vi.fn(),
  lent: { current: true },
  limit: { current: { allowed: false, current: 5, max: 5 } as Record<string, unknown> },
}));

vi.mock("@langwatch/browser-host/lent", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useLentHooks: () => (lent.current ? { open: openUpgradeModal } : undefined),
}));

vi.mock("../organization-api.ts", () => {
  const answers = (path: string): unknown =>
    path === "licenseEnforcement.checkLimit" ? limit.current : undefined;
  const endpoint = (path: string) => ({
    useQuery: () => ({ data: answers(path), isLoading: false, refetch: vi.fn() }),
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

function InviteAnother({ onAllowed = () => void 0 }: { onAllowed?: () => void }) {
  const { checkAndProceed } = useLicenseEnforcement("members");
  return (
    <button type="button" onClick={() => checkAndProceed(onAllowed)}>
      Invite another
    </button>
  );
}

describe("license enforcement", () => {
  afterEach(() => {
    cleanup();
    openUpgradeModal.mockClear();
    lent.current = true;
    limit.current = REACHED;
  });

  describe("when new members are held for a failed payment", () => {
    /** @scenario "Inviting any kind of member while a payment is unpaid names the failed payment" */
    it("sends the invite on to the server, which names the failed payment, with no upgrade prompt", async () => {
      limit.current = { allowed: false, current: 2, max: 9999, heldForPayment: true };
      const invite = vi.fn();
      const analytics = new RecordingUiAnalytics();
      renderWithOrganizationHost(<InviteAnother onAllowed={invite} />, void 0, { analytics });

      await userEvent.click(screen.getByText("Invite another"));

      expect(invite).toHaveBeenCalledTimes(1);
      expect(openUpgradeModal).not.toHaveBeenCalled();
      expect(analytics.tracked).toEqual([]);
    });
  });

  describe("when the seat limit is already reached", () => {
    /** @scenario "The upgrade modal opening is counted with what stopped the action" */
    it("counts the upgrade modal opening, with the limit that stopped the action", async () => {
      const analytics = new RecordingUiAnalytics();
      renderWithOrganizationHost(<InviteAnother />, void 0, { analytics });

      await userEvent.click(screen.getByText("Invite another"));

      expect(openUpgradeModal).toHaveBeenCalledWith("members", 5, 5);
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

  describe("when no module lends the upgrade modal", () => {
    /** @scenario A screen opens nothing while no module lends the upgrade modal */
    it("does nothing and the screen still renders", async () => {
      lent.current = false;
      renderWithOrganizationHost(<InviteAnother />, void 0, {});

      await userEvent.click(screen.getByText("Invite another"));

      expect(openUpgradeModal).not.toHaveBeenCalled();
    });
  });
});
