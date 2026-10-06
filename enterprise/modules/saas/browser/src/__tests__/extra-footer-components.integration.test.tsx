import { SaasBrowserService } from "@langwatch/enterprise-saas-contract";
import { cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ExtraFooterComponents, SaasBrowserAnalytics } from "../index.ts";

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

  /** @scenario "Delayed analytics globals are used" */
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

  describe("when the deployment is not SaaS", () => {
    /** @scenario "Third-party scripts stay dormant off SaaS" */
    it("renders no third-party script and turns the chat bubble off", () => {
      const scripts = vi.fn();
      const configureCrispBubble = vi.fn();
      function RecordingScript(props: { id: string }) {
        scripts(props.id);
        return null;
      }

      const { container } = render(
        <ExtraFooterComponents
          isSaas={false}
          user={{ id: "user-1", email: "user@example.com", name: "User", impersonator: null }}
          organization={{ id: "org-1", name: "Acme" }}
          project={{ id: "project-1", name: "Main" }}
          environment="test"
          pathname="/"
          runtime={new TestRuntime()}
          analytics={SaasBrowserAnalytics.create({ identifyPostHog: vi.fn(), intervalMs: 10 })}
          Script={RecordingScript}
          configureCrispBubble={configureCrispBubble}
        />,
      );

      expect(scripts).not.toHaveBeenCalled();
      expect(container.innerHTML).toBe("");
      expect(configureCrispBubble).toHaveBeenCalledWith(false);
    });
  });
});
