import { ChakraProvider } from "@chakra-ui/react";
import posthog from "posthog-js";
import { PostHogProvider } from "posthog-js/react";
import type { ReactNode } from "react";
import { AnalyticsProvider } from "react-contextual-analytics";
import { usePublicEnv } from "~/hooks/usePublicEnv";
import { createAppAnalyticsClient } from "~/utils/analyticsClient";
import { SessionProvider } from "~/utils/auth-client";
import { ExtraFooterComponents } from "../ee/saas/ExtraFooterComponents";
import { ColorModeProvider } from "./components/ui/color-mode";
import { Toaster } from "./components/ui/toaster";
import { CommandBarProvider } from "./features/command-bar";
import { useAttributionCapture } from "./hooks/useAttributionCapture";
import { useBrowserTracing } from "./hooks/useBrowserTracing";
import { useIsGtagReady } from "./hooks/useIsGtagReady";
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
        <ChakraProvider value={system}>
          <ColorModeProvider>{children}</ColorModeProvider>
        </ChakraProvider>
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
              `usePostHog()` initializes it in an effect once publicEnv
              resolves, so conditionally wrapping on that flip changes the
              element type at this position and React unmounts + remounts
              the ENTIRE routed page subtree shortly after boot. That
              remount wiped in-flight page state (#5550: /invite/accept
              dead-ended on the loading screen). The uninitialized
              singleton is inert when no POSTHOG_KEY is configured. */}
          <PostHogProvider client={posthog}>{children}</PostHogProvider>
        </AnalyticsProvider>
        <Toaster />
      </CommandBarProvider>
      <ExtraFooterComponents />
    </>
  );
}
