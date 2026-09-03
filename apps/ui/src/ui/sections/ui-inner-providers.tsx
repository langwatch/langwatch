/**
 * The providers that need router context, in the order they have always
 * nested, and the browser instrumentation that runs beside them.
 *
 * The instrumentation behaviours live in this package and read nothing from
 * the environment themselves; this is the one place that resolves the public
 * configuration and hands it to each of them, in the order they have always
 * run in. The command bar, the toaster, the footer, the public-configuration
 * reader and the navigation write points still belong to the composing
 * application and arrive installed.
 */

import posthog from "posthog-js";
import { PostHogProvider } from "posthog-js/react";
import type { ComponentType, ReactNode } from "react";
import { AnalyticsProvider } from "react-contextual-analytics";
import { createUiAnalyticsClient } from "../../behavior/analytics-client";
import { useBrowserTracing } from "../../behavior/browser-tracing";
import { useIsGtagReady } from "../../behavior/gtag-readiness";
import { useNavigationTracing } from "../../behavior/navigation-tracing";
import { usePostHog } from "../../behavior/posthog-analytics";
import type { PublicEnvironment } from "../../model/public-environment";
import type { UiProviderShell } from "./ui-outer-providers";

export type UiInnerProviderInstall = {
  /** The application's public configuration, as the application resolves it. */
  usePublicEnvironment: () => { data: PublicEnvironment | undefined };
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
  usePublicEnvironment,
  useNavigationTracking,
  commandBar: CommandBar,
  toaster: Toaster,
  footer: Footer,
  isDevelopment,
}: UiInnerProviderInstall): UiProviderShell {
  return function UiInnerProviders({ children }: { children: ReactNode }) {
    const publicEnv = usePublicEnvironment();
    const postHog = usePostHog(publicEnv.data);
    const isGtagReady = useIsGtagReady();
    useBrowserTracing({
      enabled: publicEnv.data?.RUM_ENABLED,
      environment: publicEnv.data?.NODE_ENV,
      sampleRatio: publicEnv.data?.RUM_SAMPLE_RATIO,
    });
    // Router context is available here — the inner providers render inside
    // RouterProvider — which is what a navigation span needs.
    useNavigationTracing({ enabled: !!publicEnv.data?.RUM_ENABLED });
    useNavigationTracking();

    return (
      <>
        <CommandBar>
          <AnalyticsProvider
            client={createUiAnalyticsClient({
              isSaaS: Boolean(publicEnv.data?.IS_SAAS),
              posthogClient: postHog,
              isGtagReady,
              isDevelopment,
            })}
          >
            {/* Always wrap in PostHogProvider with the module singleton —
                `usePostHog()` initializes it from the HTML boot configuration,
                so conditionally wrapping on that initialization changes the
                element type at this position and React unmounts + remounts
                the ENTIRE routed page subtree shortly after boot. That
                remount wiped in-flight page state (#5550: /invite/accept
                dead-ended on the loading screen). The uninitialized
                singleton is inert when no POSTHOG_KEY is configured. */}
            <PostHogProvider client={posthog}>{children}</PostHogProvider>
          </AnalyticsProvider>
          <Toaster />
        </CommandBar>
        <Footer />
      </>
    );
  };
}
