// Temporal, before anything reads a clock. A runtime that ships it natively keeps its own.
import "@langwatch/time/polyfill";
import {
  useBrowserUiSession,
  useUiSessionReading,
} from "@langwatch/auth-browser/session-capability";
import { createBrowserUiAnalytics } from "@langwatch/browser-host/browser-analytics";
import type {
  UiDeployment,
  UiFeedback,
  UiSessionCapabilities,
} from "@langwatch/browser-host/capabilities";
import { deriveUiDeployment } from "@langwatch/browser-host/deployment";
import type { UiDrawerRegistry } from "@langwatch/browser-host/drawer";
import { registerChunkReloadListener } from "@langwatch/browser-host/navigation";
import {
  createUiFeatureApiClient,
  type UiFeatureApiTransport,
} from "@langwatch/browser-host/transport";
import type { PublicAppConfig } from "@langwatch/config/public-app-config";
import { configureDocsRuntime } from "@langwatch/handled-error/docs-url";
import { webModules } from "@langwatch/installed-modules/web";
import {
  createBrowserUiScope,
  isUiPublicRoute,
  useUiScopeReading,
} from "@langwatch/organization-browser/surfaces/scope-capability";
import { createUi } from "@langwatch/ui-kernel";
import posthog from "posthog-js";
import type { ReactNode } from "react";
import { useLocation } from "react-router";

import { readPublicAppConfig } from "./behavior/public-config";
import { BrowserUiFeedback } from "./behavior/ui-feedback";
import { UiShell } from "./behavior/ui-shell";
import { UiRuntime } from "./behavior/ui.runtime";
import { GraphicsQualityProvider } from "./shell/graphics-quality-provider";
import { createUiApplication, type UiApplication } from "./shell/ui-application";
import { UiApplicationShell } from "./shell/ui-application-shell";
import { UiErrorToaster } from "./shell/ui-error-toaster";
import { installedModuleDrawers } from "./shell/ui-module-drawers";
import { installedModuleScreens, type UiModuleScreens } from "./shell/ui-module-screens";
import { uiUnservedPageLoaders } from "./shell/ui-unserved-pages";

import "nprogress/nprogress.css";
import "./styles/globals.scss";

/** A provider position no module has declared yet: an honest pass-through. */
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
 * Deliberately plain, like `shell/ui-page-fallbacks` — the words a
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

/**
 * Where the two capabilities meet, and the only place they do. Four calls in
 * the order ruling (a) fixes: who is here, where they are standing, the
 * session port over both, then the scope port over the grants the session
 * answered. `auth` and `organization` never import each other.
 */
function useBrowserUiCapabilities({
  transport,
  feedback,
}: {
  transport: UiFeatureApiTransport;
  feedback: UiFeedback;
}): UiSessionCapabilities {
  const { pathname } = useLocation();
  const sessionReading = useUiSessionReading({
    feedback,
    isPublicRoute: isUiPublicRoute(pathname),
  });
  const scopeReading = useUiScopeReading({ transport, session: sessionReading });
  const session = useBrowserUiSession({
    transport,
    session: sessionReading,
    scope: scopeReading.scope,
  });

  return { session, scope: createBrowserUiScope({ reading: scopeReading, session }) };
}

class BrowserUiShell extends UiShell {
  static create(
    config: PublicAppConfig,
    isDevelopment: boolean,
    deployment: UiDeployment,
    screens: UiModuleScreens,
    drawers: UiDrawerRegistry,
    transport: UiFeatureApiTransport,
  ): BrowserUiShell {
    return new BrowserUiShell(
      createUiApplication({
        drawers,
        features: {
          loaders: screens.loaders,
          routes: screens.routes,
          transport,
          // Without these the shell resolves the REFUSING defaults, so the first
          // session read throws instead of answering. See ARCHITECTURE.md 10.1.
          session: useBrowserUiCapabilities,
          capabilities: {
            feedback: BrowserUiFeedback.create(),
            deployment,
            // The posthog module SINGLETON, the same one `PostHogProvider` is
            // handed: inert until the inner providers initialise it, and
            // initialised well before a screen emits.
            analytics: createBrowserUiAnalytics({
              isSaaS: deployment.isSaaS,
              posthogClient: posthog,
              isGtagReady: false,
              isDevelopment,
            }),
          },
        },
        providers: {
          attribution: UiPendingProvider,
          session: UiPendingProvider,
          transport: UiPendingProvider,
          graphicsQuality: GraphicsQualityProvider,
          commandBar: UiPendingProvider,
          toaster: UiErrorToaster,
          footer: UiNoFooter,
          usePublicAppConfig: () => ({ data: config }),
          useNavigationTracking: useNoNavigationTracking,
          isDevelopment,
        },
        pages: {
          loaders: uiUnservedPageLoaders,
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

/**
 * The browser, whole: the supply validates the injected config against every
 * installed web module's declaration before a component renders; the shell
 * mounts over what it returns. Installing a module edits the catalogue.
 */
export async function startUi(): Promise<void> {
  const config = readPublicAppConfig(document);
  // One client, declared to the supply and handed to the shell: a module that
  // declares a screen declares that it reads the platform, and this answers it.
  const transport = createUiFeatureApiClient();
  const installed = await createUi({ document, mount: "root" })
    .withModules(webModules)
    .withTransport(transport)
    .withInjectedConfig(() => config)
    .render();

  configureDocsRuntime({ mode: config.mode, hostname: window.location.hostname });
  UiRuntime.create({
    document,
    shell: BrowserUiShell.create(
      config,
      config.mode === "development",
      deriveUiDeployment(config),
      installedModuleScreens(installed.modules),
      installedModuleDrawers(installed.modules),
      transport,
    ),
  }).start();
}

void startUi();
