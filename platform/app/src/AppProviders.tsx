import { UiDesignSystemShell } from "@langwatch/ui";
import posthog from "posthog-js";
import { PostHogProvider } from "posthog-js/react";
import type { ReactNode } from "react";
import { AnalyticsProvider } from "react-contextual-analytics";
import { usePublicEnv } from "~/hooks/usePublicEnv";
import { createAppAnalyticsClient } from "~/utils/analyticsClient";
import { SessionProvider } from "~/utils/auth-client";
import { EnterpriseSaasFooter } from "./components/enterprise/EnterpriseSaasFooter";
import { GraphicsQualityProvider } from "./components/GraphicsQualityProvider";
import { Toaster } from "./components/ui/toaster";
import { CommandBarProvider } from "./features/command-bar";
import { useNavigationV2Tracking } from "./features/navigation/useNavigationV2Tracking";
import { useAttributionCapture } from "./hooks/useAttributionCapture";
import { useBrowserTracing } from "./hooks/useBrowserTracing";
import { useIsGtagReady } from "./hooks/useIsGtagReady";
import { useNavigationTracing } from "./hooks/useNavigationTracing";
import { usePostHog } from "./hooks/usePostHog";
import { system } from "./theme";
import { TRPCProvider } from "./utils/api";

/**
 * Outer providers that do NOT need Router context.
 * These wrap around <RouterProvider>.
 */
export function OuterProviders({ children }: { children: ReactNode }) {
  // Capture first-touch attribution at the outermost mount point so it
  // runs on every landing URL — including unauthenticated/public pages —
  // before any navigation can drop the query string.
  useAttributionCapture();

  return (
    <SessionProvider refetchInterval={0} refetchOnWindowFocus={false}>
      <TRPCProvider>
        <UiDesignSystemShell system={system}>
          <GraphicsQualityProvider>{children}</GraphicsQualityProvider>
        </UiDesignSystemShell>
      </TRPCProvider>
    </SessionProvider>
  );
}

/**
 * Inner providers that DO need Router context.
 * These are rendered inside <RouterProvider> via the RootLayout route.
 */
export function InnerProviders({ children }: { children: ReactNode }) {
  const postHog = usePostHog();
  const publicEnv = usePublicEnv();
  const isGtagReady = useIsGtagReady();
  useBrowserTracing();
  // Router context is available here — InnerProviders renders inside
  // RouterProvider — which is what a navigation span needs.
  useNavigationTracing();
  // Navigation-v2 write points (product memory + settings return capture).
  // Inert in legacy mode.
  useNavigationV2Tracking();

  return (
    <>
      <CommandBarProvider>
        <AnalyticsProvider
          client={createAppAnalyticsClient({
            isSaaS: Boolean(publicEnv.data?.IS_SAAS),
            posthogClient: postHog,
            isGtagReady,
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
      </CommandBarProvider>
      <EnterpriseSaasFooter />
    </>
  );
}
