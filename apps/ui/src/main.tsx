// Temporal, before anything reads a clock. A runtime that ships it natively keeps its own.
import "@langwatch/time/polyfill";
import { createUi, type UiRenderResult } from "@langwatch/browser";
import { createBrowserUiAnalytics } from "@langwatch/browser-host/browser-analytics";
import type {
  UiDeployment,
  UiFeedback,
  UiSessionHostServices,
} from "@langwatch/browser-host/capabilities";
import type { UiDrawerRegistry } from "@langwatch/browser-host/drawer";
import { BrowserUiFeedback } from "@langwatch/browser-host/feedback";
import { registerChunkReloadListener, signalUiMounted } from "@langwatch/browser-host/navigation";
import { SessionVersionWatch, sessionVersionFetch } from "@langwatch/browser-host/session-version";
import {
  createUiApplication,
  installedModuleFailures,
  type UiApplication,
} from "@langwatch/browser/application";
import { UiApplicationShell } from "@langwatch/browser/application-shell";
import { UiErrorToaster } from "@langwatch/browser/error-toaster";
import type { UiFailureInterceptor } from "@langwatch/browser/feature-install";
import { GraphicsQualityProvider } from "@langwatch/browser/graphics-quality-provider";
import { installedModuleApis } from "@langwatch/browser/module-apis";
import { installedModuleDrawers } from "@langwatch/browser/module-drawers";
import { installedModuleHostMounts, type UiModuleHostMount } from "@langwatch/browser/module-hosts";
import { installedModuleScreens, type UiModuleScreens } from "@langwatch/browser/module-screens";
import { readPublicAppConfig } from "@langwatch/browser/public-config";
import { UiRuntime } from "@langwatch/browser/runtime";
import { UiShell } from "@langwatch/browser/shell";
import { readUiProcessConfig } from "@langwatch/browser/supply";
import {
  createUiFeatureApiClient,
  type UiFeatureApiBinding,
  type UiFeatureApiTransport,
} from "@langwatch/browser/transport";
import { saasWeb } from "@langwatch/enterprise-saas-browser/declaration";
import { applyFeatureFlagOverridesFromSearch } from "@langwatch/feature-flag-client";
import { configureDocsRuntime } from "@langwatch/handled-error/docs-url";
import posthog from "posthog-js";
import { type ReactNode, useEffect } from "react";
import { ErrorBoundary } from "react-error-boundary";
import { useLocation } from "react-router";

import { browserModules } from "./browser-modules.generated.ts";
import { installedUiDeclarations } from "./shell/ui-declarations";
import { uiErrorPages, type UiErrorPages } from "./shell/ui-error-page";
import {
  composeUiDesignSystem,
  loadUiRootHostServices,
  type UiRootHostServices,
} from "./shell/ui-root-host-services";
import { uiRouteTable } from "./shell/ui-route-table";
import { UiSaasFooter } from "./shell/ui-saas-footer";
import { uiShellLayouts } from "./shell/ui-shell-layouts";
import { uiUnservedPageLoaders } from "./shell/ui-unserved-pages";
import { lentFirstTouchAttribution } from "./shell/use-analytics-identity";
import {
  uiDeploymentOf,
  uiFeatureConfigOf,
  uiTelemetryOf,
  type UiFeatureConfig,
} from "./ui-feature-config";

import "nprogress/nprogress.css";
import "./styles/globals.scss";

/** A provider position no module has declared yet: an honest pass-through. */
function UiPendingProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

/** What a build without the onboarding module mounts: nothing to capture. */
const NO_ATTRIBUTION_CAPTURE = () => void 0;

/**
 * First-touch attribution capture, at the outermost provider position so it
 * reads every landing URL before a navigation can drop its query string.
 */
const useAttributionCapture =
  lentFirstTouchAttribution(installedUiDeclarations)?.useCapture ?? NO_ATTRIBUTION_CAPTURE;

function UiAttributionCapture({ children }: { children: ReactNode }) {
  useAttributionCapture();
  return <>{children}</>;
}

/** The last resort: plain, for when even the branded error page cannot draw. */
function UiBootPageError() {
  // The app answered: the boot recovery must not reload over its message.
  useEffect(signalUiMounted, []);
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
function browserUiHostServicesHook({
  session: auth,
  scope: organization,
  copyTargets: lending,
  traceFilters: filtering,
}: UiRootHostServices) {
  return function useBrowserUiHostServices({
    transport,
    feedback,
  }: {
    transport: UiFeatureApiTransport;
    feedback: UiFeedback;
  }): UiSessionHostServices {
    const { pathname, search } = useLocation();
    const isPublicRoute = organization.isUiPublicRoute(pathname);
    const sessionReading = auth.useUiSessionReading({ feedback, isPublicRoute });
    const scopeReading = organization.useUiScopeReading({ transport, session: sessionReading });
    const session = auth.useBrowserUiSession({
      transport,
      session: sessionReading,
      scope: scopeReading.scope,
      isPublicRoute,
    });

    const copyTargets = lending.useUiCopyTargetsReading({
      transport,
      organizations: scopeReading.organizations,
      userId: sessionReading.user?.id,
    });

    const scope = organization.createBrowserUiScope({ reading: scopeReading });
    const traceFilters = filtering.useUiTraceFiltersReading({
      search,
      projectId: scope.activeScope().projectId ?? void 0,
    });

    return {
      session,
      scope,
      copyTargets: lending.createBrowserUiCopyTargets({ reading: copyTargets }),
      traceFilters: filtering.createBrowserUiTraceFilters({ reading: traceFilters }),
    };
  };
}

class BrowserUiShell extends UiShell {
  static create({
    config,
    isDevelopment,
    deployment,
    screens,
    apis,
    drawers,
    transport,
    sessionVersions,
    hosts,
    failures,
    rootCapabilities,
    hostServices,
  }: {
    config: UiFeatureConfig;
    isDevelopment: boolean;
    deployment: UiDeployment;
    screens: UiModuleScreens;
    apis: readonly UiFeatureApiBinding[];
    drawers: UiDrawerRegistry;
    transport: UiFeatureApiTransport;
    sessionVersions: SessionVersionWatch;
    hosts: readonly UiModuleHostMount[];
    failures: readonly UiFailureInterceptor[];
    rootCapabilities: UiRootHostServices;
    hostServices: UiRenderResult["hostServices"];
  }): BrowserUiShell {
    const telemetry = uiTelemetryOf(config);
    const errorPages = uiErrorPages({ isDevelopment });
    return new BrowserUiShell({
      errorPages,
      application: createUiApplication({
        sessionQueryKey: rootCapabilities.session.UI_SESSION_QUERY_KEY,
        drawers,
        features: {
          loaders: screens.loaders,
          routes: screens.routes,
          apis,
          hosts,
          failures,
          transport,
          sessionVersions,
          // Without these the shell resolves the REFUSING defaults, so the first
          // session read throws instead of answering. See ARCHITECTURE.md 10.1.
          session: browserUiHostServicesHook(rootCapabilities),
          hostServices,
          footer: UiSaasFooter,
          capabilities: {
            feedback: BrowserUiFeedback.create(),
            deployment,
            declarations: installedUiDeclarations,
            supportChat: saasWeb.installation.capabilities.supportChat,
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
          attribution: UiAttributionCapture,
          session: UiPendingProvider,
          transport: UiPendingProvider,
          graphicsQuality: GraphicsQualityProvider,
          designSystem: composeUiDesignSystem(rootCapabilities),
          commandBar: UiPendingProvider,
          toaster: UiErrorToaster,
          usePublicAppConfig: () => ({ data: telemetry }),
          isDevelopment,
        },
        pages: {
          loaders: uiUnservedPageLoaders,
          table: uiRouteTable,
          shellLayouts: uiShellLayouts({ root: rootCapabilities, config }),
          errorFallback: errorPages.page,
          rootErrorBoundary: errorPages.route,
        },
      }),
    });
  }

  private constructor(
    private readonly parts: { application: UiApplication; errorPages: UiErrorPages },
  ) {
    super();
  }

  prepare(): void {
    // Before the first render, so a `?ff_` link opens straight onto the screen it names.
    applyFeatureFlagOverridesFromSearch(window.location.search);
    registerChunkReloadListener();
  }

  render(): ReactNode {
    const { application, errorPages } = this.parts;
    return (
      <ErrorBoundary FallbackComponent={UiBootPageError}>
        <ErrorBoundary FallbackComponent={errorPages.application}>
          <UiApplicationShell
            outerProvider={application.outerProvider}
            router={application.router}
          />
        </ErrorBoundary>
      </ErrorBoundary>
    );
  }
}

/**
 * The browser, whole: the supply validates the injected config against every
 * installed web module's declaration before a component renders; the shell
 * mounts over what it returns. Installing a module edits the catalogue.
 */
export async function startUi(): Promise<void> {
  const served = readPublicAppConfig(document);
  // The framework's own slice: the transport is built before the supply renders.
  const process = readUiProcessConfig(served);
  // Every answer's session version reaches the watch the shell invalidates reads from.
  const sessionVersions = SessionVersionWatch.create();
  // One client, declared to the supply and handed to the shell: a module that
  // declares a screen declares that it reads the platform, and this answers it.
  const transport = createUiFeatureApiClient({
    fetch: sessionVersionFetch({ watch: sessionVersions }),
    isDevelopment: process.mode === "development",
  });
  const rootCapabilities = await loadUiRootHostServices();
  const installed = await createUi({ document, mount: "root" })
    .withModules(browserModules)
    .withTransport(transport)
    .withInjectedConfig(() => served)
    .render();
  const config = uiFeatureConfigOf({ process, installed: installed.config });

  configureDocsRuntime({ mode: config.process.mode, hostname: window.location.hostname });
  UiRuntime.create({
    document,
    shell: BrowserUiShell.create({
      config,
      isDevelopment: config.process.mode === "development",
      deployment: uiDeploymentOf({ config, origin: window.location.origin }),
      screens: installedModuleScreens(installed.modules),
      apis: installedModuleApis(installed.modules),
      drawers: installedModuleDrawers(installed.modules),
      transport,
      sessionVersions,
      hosts: installedModuleHostMounts(installed.modules),
      failures: installedModuleFailures(installed.modules),
      rootCapabilities,
      hostServices: installed.hostServices,
    }),
  }).start();
}

void startUi();
