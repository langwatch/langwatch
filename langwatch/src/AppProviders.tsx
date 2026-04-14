import { ChakraProvider } from "@chakra-ui/react";
import { PostHogProvider } from "posthog-js/react";
import type { ReactNode } from "react";
import { AnalyticsProvider } from "react-contextual-analytics";
import { usePublicEnv } from "~/hooks/usePublicEnv";
import { createAppAnalyticsClient } from "~/utils/analyticsClient";
import { SessionProvider } from "~/utils/auth-client";
import { ColorModeProvider } from "./components/ui/color-mode";
import { Toaster } from "./components/ui/toaster";
import { usePostHog } from "./hooks/usePostHog";
import { ExtraFooterComponents } from "../ee/saas/ExtraFooterComponents";
import { CommandBarProvider } from "./features/command-bar";
import { system } from "./theme";
import { TRPCProvider } from "./utils/api";

/**
 * Outer providers that do NOT need Router context.
 * These wrap around <RouterProvider>.
 */
export function OuterProviders({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <TRPCProvider>
        <ChakraProvider value={system}>
          <ColorModeProvider>
            {children}
          </ColorModeProvider>
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

  return (
    <>
      <CommandBarProvider>
        <AnalyticsProvider
          client={createAppAnalyticsClient({
            isSaaS: Boolean(publicEnv.data?.IS_SAAS),
            posthogClient: postHog,
          })}
        >
          {postHog ? (
            <PostHogProvider client={postHog}>{children}</PostHogProvider>
          ) : (
            children
          )}
        </AnalyticsProvider>
        <Toaster />
      </CommandBarProvider>
      <ExtraFooterComponents />
    </>
  );
}
