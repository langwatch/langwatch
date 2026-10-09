/**
 * What a routed page shows instead of itself.
 */

import type { ResolvedUiFailureCopy } from "@langwatch/browser-host/feedback";
import {
  Box,
  Button,
  Center,
  Heading,
  HStack,
  Spinner,
  Stack,
  Text,
} from "@langwatch/design-system/primitives";
import { Lock } from "lucide-react";

import { UiErrorActions } from "../ui-error-actions.tsx";

/** The words for code that did not arrive, so both boundaries say the same thing. */
export const UI_CHUNK_LOAD_FAILURE_COPY = {
  title: "Could not load",
  description: "Check your connection, then try again.",
} as const;

/**
 * When part of the application's code did not arrive, after its retries. Only a reload
 * clears it: a browser may remember the failed fetch for the life of the page.
 * Spec: specs/navigation/chunk-load-retry.feature
 */
export function UiChunkLoadFailure() {
  return (
    <UiPageFailure
      copy={{ ...UI_CHUNK_LOAD_FAILURE_COPY, docsUrl: void 0, traceId: void 0 }}
      retry={{ onRetry: () => window.location.reload(), testId: "chunk-load-retry" }}
    />
  );
}

/** While the flags a page is behind have not answered. */
export function UiPageLoading() {
  return (
    <Center minHeight="60vh" padding={8}>
      <Spinner size="lg" color="fg.muted" />
    </Center>
  );
}

/** When a flag a page is behind is off: the address exists, this page does not. */
export function UiPageNotFound() {
  return (
    <Center minHeight="60vh" padding={8}>
      <Stack gap={3} align="center" maxWidth="480px" textAlign="center">
        <Heading size="lg">This page is not here</Heading>
        <Text color="fg.muted">
          The address is wrong, or this part of LangWatch is not switched on for your organization.
        </Text>
      </Stack>
    </Center>
  );
}

/** When the page exists and the viewer is missing the grant it needs. */
export function UiPageForbidden({ permission }: { permission: string }) {
  return (
    <Center minHeight="60vh" padding={8}>
      <Box
        role="note"
        borderWidth="1px"
        borderColor="border.muted"
        borderRadius="md"
        backgroundColor="bg.subtle"
        paddingX={5}
        paddingY={4}
        maxWidth="520px"
      >
        <HStack gap={3} alignItems="flex-start">
          <Box color="fg.muted" display="flex" flexShrink={0} marginTop="2px">
            <Lock size={16} aria-hidden />
          </Box>
          <Stack gap={1}>
            <Text fontWeight="medium">Access Restricted</Text>
            <Text fontSize="sm" color="fg.muted">
              Ask an organization admin to grant you the permission it needs.
            </Text>
            <Text fontSize="sm" color="fg.muted">
              Missing permission: {permission}
            </Text>
          </Stack>
        </HStack>
      </Box>
    </Center>
  );
}

/**
 * When a read the page is built on refused. The words come from the code-keyed
 * presentation registry, resolved by `resolveUiFailureCopy`; the trace id is
 * the only technical detail shown, and is what a reader quotes to support.
 */
export function UiPageFailure({
  copy,
  retry,
}: {
  copy: ResolvedUiFailureCopy;
  /** A "Try again" for a failure a reload can clear: a transient fault, or a lapsed session. */
  retry?: { onRetry: () => void; testId: string };
}) {
  return (
    <Center minHeight="60vh" padding={8}>
      <Stack gap={3} align="center" maxWidth="480px" textAlign="center" role="alert">
        <Heading size="lg">{copy.title}</Heading>
        {copy.description && <Text color="fg.muted">{copy.description}</Text>}
        {retry && (
          <Button colorPalette="orange" onClick={retry.onRetry} data-testid={retry.testId}>
            Try again
          </Button>
        )}
        <UiErrorActions
          {...(copy.docsUrl ? { docsUrl: copy.docsUrl } : {})}
          {...(copy.traceId ? { traceId: copy.traceId } : {})}
        />
      </Stack>
    </Center>
  );
}
