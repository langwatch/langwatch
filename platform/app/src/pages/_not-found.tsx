import {
  Box,
  Button,
  Code,
  Heading,
  HStack,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Ghost, RotateCcw } from "lucide-react";
import { useRouteError } from "react-router";

import { Link } from "~/components/ui/link";
import { isChunkLoadError, RELOAD_AT_KEY } from "~/utils/chunkReload";

/**
 * Shared fallback for (a) unknown routes (path="*") and (b) errors thrown
 * during render / lazy loading (errorElement on the root layout). Replaces
 * React Router's dev-only "Hey developer 👋" default, which looked like a
 * crash to customers.
 *
 * Two distinct cases — and the previous version conflated them:
 *
 *   1. Wildcard match (no error): `useRouteError()` returns undefined,
 *      and the user genuinely typed a bad URL. Show "Page not found".
 *
 *   2. ErrorBoundary trip (real exception during render / lazy load):
 *      `useRouteError()` returns the thrown value. If that value is a
 *      regular Error with no `.status`, the old code defaulted status
 *      to 404 and swallowed `error.message` entirely — making every
 *      render-throw look like a typo'd URL. Caught during the γ
 *      pre-dogfood: governance pages "404'd" but the real cause was
 *      a runtime exception silently masked. Now: any time we got a
 *      real error object, surface its message + (in dev) stack so the
 *      operator can root-cause without React-DevTools spelunking.
 */
export default function NotFoundOrErrorPage() {
  const error = useRouteError() as
    | (Error & { status?: number; statusText?: string })
    | { status?: number; statusText?: string; message?: string }
    | undefined;
  const explicitStatus = error?.status;
  const errorMessage =
    error && "message" in error && error.message ? error.message : null;
  const isChunkError = error != null && isChunkLoadError(error);
  // A real exception arrived (errorMessage present, no HTTP status) →
  // it's a runtime throw, not a 404. Promote to "Something went wrong"
  // so the message + stack get surfaced.
  const isRuntimeError = errorMessage !== null && explicitStatus === undefined;
  const status = explicitStatus ?? (isRuntimeError ? 500 : 404);
  const title =
    status === 404
      ? "Page not found"
      : isChunkError
        ? "Failed to load page"
        : "Something went wrong";
  const description =
    status === 404
      ? "The URL you were headed to does not exist (anymore). Use the nav to get back on track."
      : isChunkError
        ? "A required file could not be loaded. A browser extension or network issue may be blocking part of the app."
        : (errorMessage ??
          "An unexpected error occurred. Try going back to the dashboard.");
  const stack =
    isRuntimeError &&
    error &&
    "stack" in error &&
    typeof error.stack === "string"
      ? error.stack
      : null;
  return (
    <Box
      minHeight="100vh"
      display="flex"
      alignItems="center"
      justifyContent="center"
      padding={8}
    >
      <VStack gap={4} maxWidth="720px" textAlign="center">
        <Box color="fg.muted">
          <Ghost size={48} />
        </Box>
        <Heading size="lg">{title}</Heading>
        <Text color="fg.muted">{description}</Text>
        {stack && import.meta.env?.DEV && (
          <Code
            maxWidth="full"
            padding={3}
            fontSize="xs"
            whiteSpace="pre"
            display="block"
            overflowX="auto"
            textAlign="left"
            backgroundColor="bg.subtle"
          >
            {stack}
          </Code>
        )}
        <HStack gap={3}>
          {isChunkError && (
            <Button
              colorPalette="orange"
              onClick={() => {
                try {
                  sessionStorage.setItem(RELOAD_AT_KEY, String(Date.now()));
                } catch {
                  // sessionStorage may be unavailable
                }
                window.location.reload();
              }}
            >
              <RotateCcw size={14} />
              Reload app
            </Button>
          )}
          <Link href="/">
            <Button
              colorPalette={isChunkError ? undefined : "orange"}
              variant={isChunkError ? "outline" : "solid"}
            >
              Back to dashboard
            </Button>
          </Link>
        </HStack>
      </VStack>
    </Box>
  );
}
