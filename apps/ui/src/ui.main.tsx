import type { ReactNode } from "react";

import { configureDocsRuntime } from "@langwatch/config/docs-url";
import { webModules } from "@langwatch/installed-modules/web";
import { createUi } from "@langwatch/ui-kernel";

import { registerChunkReloadListener } from "./behavior/chunk-reload";
import { readPublicAppConfig } from "./behavior/public-config";
import { toPublicEnvironment } from "./behavior/public-environment";
import { UiShell } from "./behavior/ui-shell";
import { UiRuntime } from "./behavior/ui.runtime";
import type { PublicEnvironment } from "./model/public-environment";
import { UiErrorToaster } from "./ui/elements/ui-error-toaster";
import { GraphicsQualityProvider } from "./ui/sections/graphics-quality-provider";
import { createUiApplication, type UiApplication } from "./ui/sections/ui-application";
import { UiApplicationShell } from "./ui/sections/ui-application-shell";

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

class BrowserUiShell extends UiShell {
  static create(environment: PublicEnvironment, isDevelopment: boolean): BrowserUiShell {
    return new BrowserUiShell(
      createUiApplication({
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
 * installed web module's declaration before a single component renders, and
 * the shell mounts over what it returns. Installing a module edits the
 * catalogue, never this file.
 */
export async function startUi(): Promise<void> {
  const config = readPublicAppConfig(document);
  await createUi({ document, mount: "root" })
    .withModules(webModules)
    .withInjectedConfig(() => config)
    .render();

  configureDocsRuntime({ mode: config.mode, hostname: window.location.hostname });
  const environment = toPublicEnvironment(config);
  UiRuntime.create({
    document,
    shell: BrowserUiShell.create(environment, config.mode === "development"),
  }).start();
}
