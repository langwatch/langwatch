/**
 * The providers that need router context, in the order they have always nested, and the
 * browser instrumentation that runs beside them.
 */

import type { PublicAppConfig } from "@langwatch/config/public-app-config";
import posthog from "posthog-js";
import { PostHogProvider } from "posthog-js/react";
import type { ComponentType, ReactNode } from "react";

import { useBrowserTracing } from "@langwatch/browser-host/browser-tracing";
import { useNavigationTracing } from "@langwatch/browser-host/navigation-tracing";
import { usePostHog } from "@langwatch/browser-host/posthog";
import type { UiProviderShell } from "./ui-outer-providers";

export type UiInnerProviderInstall = {
  /** The application's public configuration, as the application resolves it. */
  usePublicAppConfig: () => { data: PublicAppConfig | undefined };
  /** Product-memory and settings-return write points, mounted once. */
  useNavigationTracking: () => void;
  commandBar: UiProviderShell;
  toaster: ComponentType;
  footer: ComponentType;
  /**
   * Whether this is a development build. Supplied by the composing
   * application: browser UI never reads the process environment, and the
   * bundler define that answers it belongs to the application build.
   */
  isDevelopment: boolean;
};

export function createUiInnerProvider({
  usePublicAppConfig,
  useNavigationTracking,
  commandBar: CommandBar,
  toaster: Toaster,
  footer: Footer,
}: UiInnerProviderInstall): UiProviderShell {
  return function UiInnerProviders({ children }: { children: ReactNode }) {
    const publicConfig = usePublicAppConfig();
    usePostHog(publicConfig.data);
    useBrowserTracing({
      enabled: publicConfig.data?.telemetry.browserTracing,
      environment: publicConfig.data?.mode,
      sampleRatio: publicConfig.data?.telemetry.sampleRatio,
    });
    // Router context is available here — the inner providers render inside
    // RouterProvider — which is what a navigation span needs.
    useNavigationTracing({ enabled: !!publicConfig.data?.telemetry.browserTracing });
    useNavigationTracking();

    return (
      <>
        <CommandBar>
          {/* Always wrap in PostHogProvider with the module singleton: conditionally
                wrapping changes the element type here, so React unmounts and remounts
                the ENTIRE routed page after boot, wiping in-flight state (#5550). The
                uninitialized singleton is inert with no POSTHOG_KEY configured. */}
          <PostHogProvider client={posthog}>{children}</PostHogProvider>
          <Toaster />
        </CommandBar>
        <Footer />
      </>
    );
  };
}
