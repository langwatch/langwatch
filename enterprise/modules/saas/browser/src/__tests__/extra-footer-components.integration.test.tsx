// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ExtraFooterComponents, SaasBrowserAnalytics } from "../index.ts";

type AnalyticsWindow = Window & {
  gtag?: (...args: unknown[]) => void;
  Reo?: { identify: (value: unknown) => void };
};

const analyticsWindow: AnalyticsWindow = window;
const organization = { id: "org-1", name: "Acme" };
const project = { id: "project-1", name: "Main" };

function renderFooter({
  isSaas = true,
  impersonator = null,
  updateLastLogin = vi.fn(),
}: {
  isSaas?: boolean;
  impersonator?: { id: string } | null;
  updateLastLogin?: () => void;
}) {
  return render(
    <ExtraFooterComponents
      isSaas={isSaas}
      user={{ id: "user-1", email: "user@example.com", name: "User", impersonator }}
      organization={organization}
      project={project}
      environment="test"
      pathname="/"
      updateLastLogin={updateLastLogin}
      analytics={SaasBrowserAnalytics.create({ intervalMs: 10 })}
    />,
  );
}

describe("ExtraFooterComponents", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    delete analyticsWindow.gtag;
    delete analyticsWindow.Reo;
  });
  afterEach(() => {
    cleanup();
    document.body.querySelectorAll("script").forEach((script) => script.remove());
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  /** @scenario "Delayed analytics globals are used" */
  it("tracks delayed gtag and Reo globals", async () => {
    const updateLastLogin = vi.fn();
    renderFooter({ updateLastLogin });
    const gtag = vi.fn();
    const identify = vi.fn();
    analyticsWindow.gtag = gtag;
    analyticsWindow.Reo = { identify };
    await vi.advanceTimersByTimeAsync(20);
    expect(gtag).toHaveBeenCalledWith(
      "event",
      "open_dashboard",
      expect.objectContaining({ organization_id: "org-1" }),
    );
    expect(identify).toHaveBeenCalledOnce();
    expect(updateLastLogin).toHaveBeenCalledOnce();
    expect(document.getElementById("gtm-init")).not.toBeNull();
    expect(document.getElementById("pendo")).not.toBeNull();
  });

  describe("when an operator is impersonating", () => {
    it("neither tracks the dashboard open nor records a login", async () => {
      const updateLastLogin = vi.fn();
      const gtag = vi.fn();
      analyticsWindow.gtag = gtag;
      renderFooter({ impersonator: { id: "admin-1" }, updateLastLogin });
      await vi.advanceTimersByTimeAsync(20);
      expect(gtag).not.toHaveBeenCalled();
      expect(updateLastLogin).not.toHaveBeenCalled();
      expect(document.getElementById("pendo")).toBeNull();
    });
  });

  describe("when the deployment is not SaaS", () => {
    /** @scenario "Third-party scripts stay dormant off SaaS" */
    it("renders no third-party script", () => {
      const { container } = renderFooter({ isSaas: false });

      expect(document.body.querySelectorAll("script")).toHaveLength(0);
      expect(container.innerHTML).toBe("");
    });
  });
});
