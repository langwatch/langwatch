// Temporal, before anything reads a clock. A runtime that ships it natively keeps its own.
import "@langwatch/time/polyfill";
import type { UiDrawerRegistry } from "@langwatch/browser-host/drawer";
import { configureDocsRuntime } from "@langwatch/config/docs-url";
import { webModules } from "@langwatch/installed-modules/web";
import { createUi } from "@langwatch/ui-kernel";
import type { ReactNode } from "react";

import { registerChunkReloadListener } from "./behavior/chunk-reload";
import { readPublicAppConfig } from "./behavior/public-config";
import { toPublicEnvironment } from "./behavior/public-environment";
import {
  createUiFeatureApiClient,
  type UiFeatureApiTransport,
} from "./behavior/ui-feature-transport";
import { installedModuleScreens, type UiModuleScreens } from "./behavior/ui-module-screens";
import { UiShell } from "./behavior/ui-shell";
import { UiRuntime } from "./behavior/ui.runtime";
import type { PublicEnvironment } from "./model/public-environment";
import { GraphicsQualityProvider } from "./shell/graphics-quality-provider";
import { createUiApplication, type UiApplication } from "./shell/ui-application";
import { UiApplicationShell } from "./shell/ui-application-shell";
import { UiErrorToaster } from "./shell/ui-error-toaster";
import { installedModuleDrawers } from "./shell/ui-module-drawers";

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

class BrowserUiShell extends UiShell {
  static create(
    environment: PublicEnvironment,
    isDevelopment: boolean,
    screens: UiModuleScreens,
    drawers: UiDrawerRegistry,
    transport: UiFeatureApiTransport,
  ): BrowserUiShell {
    return new BrowserUiShell(
      createUiApplication({
        drawers,
        features: { loaders: screens.loaders, routes: screens.routes, transport },
        providers: {
          attribution: UiPendingProvider,
          session: UiPendingProvider,
          transport: UiPendingProvider,
          graphicsQuality: GraphicsQualityProvider,
          commandBar: UiPendingProvider,
          toaster: UiErrorToaster,
          footer: UiNoFooter,
          usePublicEnvironment: () => ({ data: environment }),
          useNavigationTracking: useNoNavigationTracking,
          isDevelopment,
        },
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
  const environment = toPublicEnvironment(config);
  UiRuntime.create({
    document,
    shell: BrowserUiShell.create(
      environment,
      config.mode === "development",
      installedModuleScreens(installed.modules),
      installedModuleDrawers(installed.modules),
      transport,
    ),
  }).start();
}

void startUi();
