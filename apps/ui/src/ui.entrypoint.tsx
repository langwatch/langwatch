/**
 * The browser entry: what `index.html` loads, the only module that runs on
 * import. Unfilled slots (command bar, footer) are honest pass-throughs —
 * named in `dev/docs/plans/strict-feature-layout.md`.
 */

// Temporal, before anything reads a clock. A runtime that ships it natively keeps its own.
import "@langwatch/time/polyfill";

import type { ReactNode } from "react";
import { configureDocsRuntime } from "@langwatch/config/docs-url";
import { registerChunkReloadListener } from "./behavior/chunk-reload";
import { readPublicAppConfig } from "./behavior/public-config";
import { toPublicEnvironment } from "./behavior/public-environment";
import { UiShellPort } from "./behavior/ui-runtime.port";
import { UiRuntime } from "./behavior/ui.runtime";
import { createUiApplication } from "./features/installed-ui-features.composition";
import { parseUiFeatureConfig } from "./behavior/ui-feature-config";
import { OnboardingAttributionProvider } from "./features/onboarding/ui/sections/onboarding-attribution-provider";
import type { PublicEnvironment } from "./model/public-environment";
import { UiErrorToaster } from "./ui/elements/ui-error-toaster";
import { GraphicsQualityProvider } from "./ui/sections/graphics-quality-provider";
import { UiApplicationShell } from "./ui/sections/ui-application-shell";
import type { UiApplication } from "./ui/sections/ui-application";

import "nprogress/nprogress.css";
import "./styles/globals.scss";

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
 * Read and validated once, at boot, before the first render: every feature's
 * own web schema parses the slice it acts on, so a browser never draws a
 * screen over a value its feature would have refused. The hook below only
 * hands back what boot already resolved.
 */
let publicEnvironment: PublicEnvironment | undefined;
function resolveBootPublicEnvironment(): PublicEnvironment {
  const config = readPublicAppConfig();
  parseUiFeatureConfig(config);
  configureDocsRuntime({
    mode: config.mode,
    hostname: typeof window === "undefined" ? undefined : window.location.hostname,
  });
  publicEnvironment = toPublicEnvironment(config);
  return publicEnvironment;
}

function useBootPublicEnvironment(): { data: PublicEnvironment | undefined } {
  return { data: publicEnvironment ?? resolveBootPublicEnvironment() };
}

/**
 * Deliberately plain, like `ui/sections/ui-page-fallbacks` — the words a
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
          attribution: OnboardingAttributionProvider,
          session: UiPendingProvider,
          transport: UiPendingProvider,
          graphicsQuality: GraphicsQualityProvider,
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

resolveBootPublicEnvironment();
UiRuntime.create({ document, shell: BrowserUiShell.create() }).start();
