import {
  createUiApplication,
  registerChunkReloadListener,
  UiApplicationShell,
  UiShellPort,
  type UiApplication,
} from "@langwatch/ui";
import type { ReactNode } from "react";
import { EnterpriseSaasFooter } from "~/components/enterprise/EnterpriseSaasFooter";
import { GraphicsQualityProvider } from "~/components/GraphicsQualityProvider";
import { PageErrorFallback } from "~/components/ui/PageErrorFallback";
import { Toaster } from "~/components/ui/toaster";
import { CommandBarProvider } from "~/features/command-bar";
import { useNavigationV2Tracking } from "~/features/navigation/useNavigationV2Tracking";
import { useAttributionCapture } from "~/hooks/useAttributionCapture";
import { usePublicEnv } from "~/hooks/usePublicEnv";
import NotFoundOrErrorPage from "~/pages/_not-found";
import { TRPCProvider } from "~/utils/api";
import { SessionProvider } from "~/utils/auth-client";
import { setRouterInstance } from "~/utils/compat/next-router";
import { legacyPageLoaders } from "./legacy-page-loaders";

/**
 * What this application still owns of its own browser shell.
 *
 * `@langwatch/ui` owns the structure — provider order, root layout, route
 * table, router — and this adapter supplies the pieces that have not moved
 * out of `platform/app` yet: the session and transport providers, the command
 * bar, the toaster, the footer, the public-configuration reader, and a lazy
 * loader for every page key the route table names. Each slot is filled by a
 * module-scope component so its element type never changes between renders.
 *
 * The adapter stays until URL and provider parity is proven; see the UI rows
 * of the core-application feature extraction plan.
 */

function LegacyAttributionCapture({ children }: { children: ReactNode }) {
  useAttributionCapture();
  return <>{children}</>;
}

function LegacySessionProvider({ children }: { children: ReactNode }) {
  return (
    <SessionProvider refetchInterval={0} refetchOnWindowFocus={false}>
      {children}
    </SessionProvider>
  );
}

export class LegacyUiShellAdapter extends UiShellPort {
  static create(): LegacyUiShellAdapter {
    return new LegacyUiShellAdapter(
      createUiApplication({
        providers: {
          attribution: LegacyAttributionCapture,
          session: LegacySessionProvider,
          transport: TRPCProvider,
          graphicsQuality: GraphicsQualityProvider,
          commandBar: CommandBarProvider,
          toaster: Toaster,
          footer: EnterpriseSaasFooter,
          usePublicEnvironment: usePublicEnv,
          useNavigationTracking: useNavigationV2Tracking,
          isDevelopment: process.env.NODE_ENV !== "production",
        },
        pages: {
          loaders: legacyPageLoaders,
          errorFallback: PageErrorFallback,
          rootErrorBoundary: NotFoundOrErrorPage,
        },
      }),
    );
  }

  private constructor(private readonly application: UiApplication) {
    super();
  }

  /** The compatibility layer that fakes a Next.js router reads this one. */
  get router() {
    return this.application.router;
  }

  prepare(): void {
    setRouterInstance(this.application.router);
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
