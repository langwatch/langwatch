/**
 * What a routed page shows instead of itself.
 */

import { Box, Center, Heading, HStack, Spinner, Stack, Text } from "@chakra-ui/react";
import { Lock } from "lucide-react";

import type { ResolvedUiFailureCopy } from "../../behavior/ui-feedback";
import { UiErrorActions } from "../elements/ui-error-actions";

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
            <Text fontWeight="medium">You do not have access to this page</Text>
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
export function UiPageFailure({ copy }: { copy: ResolvedUiFailureCopy }) {
  return (
    <Center minHeight="60vh" padding={8}>
      <Stack gap={3} align="center" maxWidth="480px" textAlign="center" role="alert">
        <Heading size="lg">{copy.title}</Heading>
        {copy.description && <Text color="fg.muted">{copy.description}</Text>}
        <UiErrorActions
          {...(copy.docsUrl ? { docsUrl: copy.docsUrl } : {})}
          {...(copy.traceId ? { traceId: copy.traceId } : {})}
        />
      </Stack>
    </Center>
  );
}
