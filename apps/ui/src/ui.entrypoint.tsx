/**
 * The browser entry: what `index.html` loads, and the only module in this
 * package that runs on import.
 *
 * `platform/app/src/main.tsx` used to be this file, and it handed
 * `createUiApplication` a shell adapter full of components that lived in the
 * old application. Those are gone, so the boot is written here against what
 * this package owns: its own feature registry answers every page key, its own
 * feature shell builds the transport and the QueryClient, and its own session
 * reads the deployment.
 *
 * WHAT IS STILL A PLACEHOLDER, and why each one is honest rather than missing.
 * `createUiApplication` takes eleven host-owned slots. This boot fills the ones
 * this package can already answer and passes a pass-through for the ones whose
 * implementation has not moved out of `platform/app` yet — first-touch
 * attribution, the graphics-quality preference, the command bar and the SaaS
 * footer. A pass-through renders its children and nothing else, so the
 * application composes and routes exactly as it will once those land; what a
 * customer loses until then is the feature itself, not the page. Each one is
 * named in the UI rows of `dev/docs/plans/core-application-feature-extraction-plan.md`.
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
 * The public configuration, read once from the HTML shell.
 *
 * Read inside the hook rather than at module scope so a shell that did not
 * inject the boot configuration surfaces through the root error boundary with
 * `readPublicAppConfig`'s own sentence, instead of blanking the document before
 * React mounts.
 *
 * This is also where the docs runtime is configured, because it is the first
 * and only point that holds both halves of it. `@langwatch/config/docs-url` is
 * shared by five families that each used to read `import.meta.env.DEV` for
 * themselves; it receives the deployment's mode instead, and a package may not
 * read the environment. It resolves as production until told otherwise — the
 * safe default, since the docs-origin allowlist in `read-handled-error` is
 * derived from it — so it is configured here, above the router, before any
 * screen renders a link.
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
 * What a routed page shows when it throws.
 *
 * Deliberately plain, for the same reason as `ui/elements/ui-page-fallbacks`:
 * the words a customer reads for a named failure come from the client error
 * presentation registry, whose harvest out of `platform/app` is its own slice.
 * This says the true thing until then.
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
