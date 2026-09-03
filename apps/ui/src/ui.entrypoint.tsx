/**
 * The browser entry: what `index.html` loads, the only module that runs on
 * import. Unfilled slots (attribution, graphics quality, command bar,
 * footer) are honest pass-throughs — named in `core-application-feature-extraction-plan.md`.
 */

import type { ReactNode } from "react";
import { configureDocsRuntime } from "@langwatch/config/docs-url";
import { registerChunkReloadListener } from "./behavior/chunk-reload";
import { readPublicAppConfig } from "./behavior/public-config";
import { toPublicEnvironment } from "./behavior/public-environment";
import { UiShellPort } from "./behavior/ui-runtime.port";
import { UiRuntime } from "./behavior/ui.runtime";
import { createUiApplication } from "./features/installed-ui-features.composition";
import type { PublicEnvironment } from "./model/public-environment";
import { UiErrorToaster } from "./ui/elements/ui-error-toaster";
import { UiApplicationShell } from "./ui/sections/ui-application-shell";
import type { UiApplication } from "./ui/sections/ui-application";

import "nprogress/nprogress.css";

/** A provider position whose implementation has not moved here yet. */
function UiPendingProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

/** The SaaS footer has not moved here yet, and self-hosted never had one. */
function UiNoFooter() {
  return null;
}

/** Product-memory and settings-return write points have not moved here yet. */
function useNoNavigationTracking() {}

/**
 * Read once, inside the hook rather than module scope, so a missing boot
 * configuration surfaces through the root error boundary instead of
 * blanking the document. Also configures the docs runtime here, first.
 */
let publicEnvironment: PublicEnvironment | undefined;
function useBootPublicEnvironment(): { data: PublicEnvironment | undefined } {
  if (!publicEnvironment) {
    const config = readPublicAppConfig();
    configureDocsRuntime({
      mode: config.mode,
      hostname: typeof window === "undefined" ? undefined : window.location.hostname,
    });
    publicEnvironment = toPublicEnvironment(config);
  }
  return { data: publicEnvironment };
}

/**
 * Deliberately plain, like `ui/elements/ui-page-fallbacks` — the words a
 * customer reads for a named failure come from the client error
 * presentation registry, not yet harvested here. This says the true thing.
 */
function UiBootPageError() {
  return (
    <div role="alert" style={{ padding: "3rem", textAlign: "center" }}>
      <h1 style={{ fontSize: "1.25rem", marginBottom: "0.5rem" }}>This page did not load</h1>
      <p style={{ opacity: 0.7 }}>Something went wrong on our side. Try again in a moment.</p>
    </div>
  );
}

class BrowserUiShell extends UiShellPort {
  static create(): BrowserUiShell {
    return new BrowserUiShell(
      createUiApplication({
        providers: {
          attribution: UiPendingProvider,
          session: UiPendingProvider,
          transport: UiPendingProvider,
          graphicsQuality: UiPendingProvider,
          commandBar: UiPendingProvider,
          toaster: UiErrorToaster,
          footer: UiNoFooter,
          usePublicEnvironment: useBootPublicEnvironment,
          useNavigationTracking: useNoNavigationTracking,
          isDevelopment: import.meta.env.DEV,
        },
        // Every page key the route table names is answered by this package's
        // own registry, so the host contributes none.
        pages: {
          loaders: {},
          errorFallback: UiBootPageError,
          rootErrorBoundary: UiBootPageError,
        },
      }),
    );
  }

  private constructor(private readonly application: UiApplication) {
    super();
  }

  prepare(): void {
    registerChunkReloadListener();
  }

  render(): ReactNode {
    return (
      <UiApplicationShell
        outerProvider={this.application.outerProvider}
        router={this.application.router}
      />
    );
  }
}

UiRuntime.create({ document, shell: BrowserUiShell.create() }).start();
