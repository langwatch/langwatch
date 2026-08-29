import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { SaasBrowserService } from "@langwatch/enterprise-saas-contract";
import { ExtraFooterComponents, SaasBrowserAnalytics } from "../index";

class TestRuntime extends SaasBrowserService {
  updateLastLogin = vi.fn();
}

function NullScript(_props: {
  id: string;
  strategy?: "afterInteractive" | "beforeInteractive" | "lazyOnload" | "worker";
  children?: ReactNode;
}) {
  return null;
}

describe("ExtraFooterComponents", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    delete (window as Window & { gtag?: unknown }).gtag;
    delete (window as Window & { Reo?: unknown }).Reo;
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("tracks delayed gtag and Reo globals", async () => {
    const identifyPostHog = vi.fn();
    render(
      <ExtraFooterComponents
        isSaas
        user={{
          id: "user-1",
          email: "user@example.com",
          name: "User",
          impersonator: null,
        }}
        organization={{ id: "org-1", name: "Acme" }}
        project={{ id: "project-1", name: "Main" }}
        environment="test"
        pathname="/"
        runtime={new TestRuntime()}
        analytics={SaasBrowserAnalytics.create({ identifyPostHog, intervalMs: 10 })}
        Script={NullScript}
        configureCrispBubble={() => undefined}
      />,
    );
    const gtag = vi.fn();
    const identify = vi.fn();
    (window as Window & { gtag?: typeof gtag }).gtag = gtag;
    (window as Window & { Reo?: { identify: typeof identify } }).Reo = { identify };
    await vi.advanceTimersByTimeAsync(20);
    expect(gtag).toHaveBeenCalledWith(
      "event",
      "open_dashboard",
      expect.objectContaining({ organization_id: "org-1" }),
    );
    expect(identify).toHaveBeenCalledOnce();
  });
});
