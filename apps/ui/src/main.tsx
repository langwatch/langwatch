// Temporal, before anything reads a clock. A runtime that ships it natively keeps its own.
import "@langwatch/time/polyfill";
import { createBrowserUiAnalytics } from "@langwatch/browser-host/browser-analytics";
import { cachePlanFor, unbatchedCachePaths } from "@langwatch/browser-host/cache-tiers";
import type {
  UiDeployment,
  UiFeedback,
  UiSessionCapabilities,
} from "@langwatch/browser-host/capabilities";
import type { UiDrawerRegistry } from "@langwatch/browser-host/drawer";
import { BrowserUiFeedback, resolveUiFailureCopy } from "@langwatch/browser-host/feedback";
import { registerChunkReloadListener } from "@langwatch/browser-host/navigation";
import { SessionVersionWatch, sessionVersionFetch } from "@langwatch/browser-host/session-version";
import {
  createUiFeatureApiClient,
  type UiFeatureApiBinding,
  type UiFeatureApiTransport,
} from "@langwatch/browser-host/transport";
import { configureDocsRuntime } from "@langwatch/error-presentation/docs-url";
import { webModules } from "@langwatch/installed-web-modules";
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

import { composeUiDesignSystem } from "./design-system";
import { installedUiDeclarations } from "./shell/ui-declarations";
import { loadUiRootCapabilities, type UiRootCapabilities } from "./shell/ui-root-capabilities";
import { uiRouteTable } from "./shell/ui-route-table";
import { uiShellLayouts } from "./shell/ui-shell-layouts";
import { uiUnservedPageLoaders } from "./shell/ui-unserved-pages";
import {
  parseUiFeatureConfig,
  uiDeploymentOf,
  uiTelemetryOf,
  type UiFeatureConfig,
} from "./ui-feature-config";

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
function browserUiCapabilitiesHook({
  session: auth,
  scope: organization,
  copyTargets: lending,
}: UiRootCapabilities) {
  return function useBrowserUiCapabilities({
    transport,
    feedback,
  }: {
    transport: UiFeatureApiTransport;
    feedback: UiFeedback;
  }): UiSessionCapabilities {
    const { pathname } = useLocation();
    const sessionReading = auth.useUiSessionReading({
      feedback,
      isPublicRoute: organization.isUiPublicRoute(pathname),
    });
    const scopeReading = organization.useUiScopeReading({ transport, session: sessionReading });
    const session = auth.useBrowserUiSession({
      transport,
      session: sessionReading,
      scope: scopeReading.scope,
    });

    const copyTargets = lending.useUiCopyTargetsReading({
      transport,
      organizations: scopeReading.organizations,
      userId: sessionReading.user?.id,
    });

    return {
      session,
      scope: organization.createBrowserUiScope({ reading: scopeReading, session }),
      copyTargets: lending.createBrowserUiCopyTargets({ reading: copyTargets }),
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
    rootCapabilities,
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
    rootCapabilities: UiRootCapabilities;
  }): BrowserUiShell {
    const telemetry = uiTelemetryOf(config);
    return new BrowserUiShell(
      createUiApplication({
        sessionQueryKey: rootCapabilities.session.UI_SESSION_QUERY_KEY,
        drawers,
        features: {
          loaders: screens.loaders,
          routes: screens.routes,
          apis,
          hosts,
          transport,
          sessionVersions,
          // Without these the shell resolves the REFUSING defaults, so the first
          // session read throws instead of answering. See ARCHITECTURE.md 10.1.
          session: browserUiCapabilitiesHook(rootCapabilities),
          capabilities: {
            feedback: BrowserUiFeedback.create(),
            deployment,
            declarations: installedUiDeclarations,
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
          designSystem: composeUiDesignSystem(rootCapabilities),
          commandBar: UiPendingProvider,
          toaster: UiErrorToaster,
          footer: UiNoFooter,
          usePublicAppConfig: () => ({ data: telemetry }),
          useNavigationTracking: useNoNavigationTracking,
          isDevelopment,
        },
        pages: {
          loaders: uiUnservedPageLoaders,
          table: uiRouteTable,
          shellLayouts: uiShellLayouts(rootCapabilities),
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
  const served = readPublicAppConfig(document);
  const config = parseUiFeatureConfig(served);
  // Session and reference reads travel unbatched, and every answer's session version
  // reaches the watch the shell invalidates the session tier from (ADR-164).
  const cachePlan = cachePlanFor({
    contracts: webModules.flatMap((module) => module.installation.apiContracts ?? []),
  });
  const sessionVersions = SessionVersionWatch.create();
  // One client, declared to the supply and handed to the shell: a module that
  // declares a screen declares that it reads the platform, and this answers it.
  const transport = createUiFeatureApiClient({
    fetch: sessionVersionFetch({ watch: sessionVersions }),
    unbatchedPaths: unbatchedCachePaths({ plan: cachePlan }),
  });
  const rootCapabilities = await loadUiRootCapabilities();
  const installed = await createUi({ document, mount: "root" })
    .withModules(webModules)
    .withTransport(transport)
    .withInjectedConfig(() => served)
    .render();

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
      rootCapabilities,
    }),
  }).start();
}

void startUi();
