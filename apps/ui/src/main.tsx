// Temporal, before anything reads a clock. A runtime that ships it natively keeps its own.
import "@langwatch/time/polyfill";
import { UI_SESSION_QUERY_KEY } from "@langwatch/auth-browser/session";
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
import { BrowserUiFeedback, resolveUiFailureCopy } from "@langwatch/browser-host/feedback";
import { registerChunkReloadListener } from "@langwatch/browser-host/navigation";
import {
  createUiFeatureApiClient,
  type UiFeatureApiBinding,
  type UiFeatureApiTransport,
} from "@langwatch/browser-host/transport";
import type { PublicAppConfig } from "@langwatch/config/public-app-config";
import { configureDocsRuntime } from "@langwatch/error-presentation/docs-url";
import { webModules } from "@langwatch/installed-modules/web";
import {
  createBrowserUiScope,
  isUiPublicRoute,
  useUiScopeReading,
} from "@langwatch/organization-browser/surfaces/scope-capability";
import { createUi } from "@langwatch/ui-kernel";
import { createUiApplication, type UiApplication } from "@langwatch/ui-kernel/application";
import { UiApplicationShell } from "@langwatch/ui-kernel/application-shell";
import { UiErrorToaster } from "@langwatch/ui-kernel/error-toaster";
import { GraphicsQualityProvider } from "@langwatch/ui-kernel/graphics-quality-provider";
import { installedModuleApis } from "@langwatch/ui-kernel/module-apis";
import { installedModuleDrawers } from "@langwatch/ui-kernel/module-drawers";
import {
  installedModuleHostMounts,
  type UiModuleHostMount,
} from "@langwatch/ui-kernel/module-hosts";
import { installedModuleScreens, type UiModuleScreens } from "@langwatch/ui-kernel/module-screens";
import { UiPageFailure } from "@langwatch/ui-kernel/page-fallbacks";
import { readPublicAppConfig } from "@langwatch/ui-kernel/public-config";
import { UiRuntime } from "@langwatch/ui-kernel/runtime";
import { UiShell } from "@langwatch/ui-kernel/shell";
import posthog from "posthog-js";
import type { ReactNode } from "react";
import type { FallbackProps } from "react-error-boundary";
import { useLocation } from "react-router";

import { uiDesignSystem } from "./design-system";
import { uiRouteTable } from "./shell/ui-route-table";
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
 * A page that threw, said properly: this renders inside the providers, so the
 * words come from the code-keyed registry rather than `error.message`.
 */
function UiPageError({ error }: FallbackProps) {
  return (
    <UiPageFailure
      copy={resolveUiFailureCopy({ error, fallbackTitle: "This page did not load" })}
    />
  );
}

/** The last resort: plain, because it must render when nothing else loaded. */
function UiBootPageError() {
  return (
    <div role="alert" style={{ padding: "3rem", textAlign: "center" }}>
      <h1 style={{ fontSize: "1.25rem", marginBottom: "0.5rem" }}>This page did not load</h1>
      <p style={{ opacity: 0.7 }}>Something went wrong on our side. Try again in a moment.</p>
    </div>
  );
}

/**
 * Where the two capabilities meet, and the only place they do — in the order
 * record 10.1 rules. `auth` and `organization` never import each other.
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
    apis: readonly UiFeatureApiBinding[],
    drawers: UiDrawerRegistry,
    transport: UiFeatureApiTransport,
    hosts: readonly UiModuleHostMount[],
  ): BrowserUiShell {
    return new BrowserUiShell(
      createUiApplication({
        sessionQueryKey: UI_SESSION_QUERY_KEY,
        drawers,
        features: {
          loaders: screens.loaders,
          routes: screens.routes,
          apis,
          hosts,
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
          designSystem: uiDesignSystem,
          commandBar: UiPendingProvider,
          toaster: UiErrorToaster,
          footer: UiNoFooter,
          usePublicAppConfig: () => ({ data: config }),
          useNavigationTracking: useNoNavigationTracking,
          isDevelopment,
        },
        pages: {
          loaders: uiUnservedPageLoaders,
          table: uiRouteTable,
          shellLayouts: {
            auth: () => import("./shell/ui-auth-host"),
            chrome: () => import("./shell/ui-app-chrome"),
          },
          errorFallback: UiPageError,
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
      installedModuleApis(installed.modules),
      installedModuleDrawers(installed.modules),
      transport,
      installedModuleHostMounts(installed.modules),
    ),
  }).start();
}

void startUi();
