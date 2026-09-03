/**
 * What a routed page shows instead of itself.
 *
 * The three answers `withUiPageGuard` can give — still asking, not here, not
 * yours — as three small components every frontend feature can pass it. They
 * live in the global layer rather than in a feature because the guard is
 * shared, and a family that wants its own look passes its own.
 *
 * DELIBERATELY PLAIN, and worth saying why. `platform/app` answers the same
 * three states with a full-viewport logo screen (`LoadingScreen`), a 486-line
 * canvas scene over a 439-line renderer (`NotFoundScene`) and a permission
 * alert that reads its copy out of the client presentation registry
 * (`PermissionAlert`). None of the three can move as it stands: the scene reads
 * `process.env`, which browser UI may not, and the alert's words come from a
 * ~90-entry registry whose harvest is its own slice. These say the same thing
 * with the same tone until those land.
 */

import { Box, Center, Heading, HStack, Spinner, Stack, Text } from "@chakra-ui/react";
import { Lock } from "lucide-react";

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
