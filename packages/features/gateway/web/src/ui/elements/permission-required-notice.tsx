/**
 * One region of a page the viewer does not hold the permission for.
 *
 * Harvested from `platform/app/src/components/PermissionRequiredNotice.tsx`.
 * The structure and the tone are unchanged; what could not come with it is the
 * copy source. The platform component reads the `insufficient_permissions`
 * entry out of the client presentation registry, and that registry is a
 * `platform/app` module of ~90 entries whose harvest is its own slice. The two
 * lines it produced for this code are stated here instead, so the panel still
 * reads the way a server refusal for the same code reads.
 *
 * Not an error state: nothing failed, so the tone is muted and there is no
 * error id to quote. A query that fails anyway still renders the error alert.
 *
 * The governance family carries the same element, for the same reason and
 * with the same gap. They converge when the registry moves.
 */

import { Box, HStack, Stack, Text } from "@chakra-ui/react";
import { Lock } from "lucide-react";

const TITLE = "You do not have access to this";
const DESCRIPTION = "Ask an organization admin to grant you the permission this panel needs.";

export function PermissionRequiredNotice({
  permission,
  detail,
}: {
  /** The grant the panel needs, named back to the reader verbatim. */
  permission: string;
  /** One extra line about what stays hidden without it. Optional. */
  detail?: string;
}) {
  return (
    <Box
      role="note"
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="md"
      backgroundColor="bg.subtle"
      paddingX={4}
      paddingY={3}
    >
      <HStack gap={3} alignItems="flex-start">
        <Box color="fg.muted" display="flex" flexShrink={0} marginTop="2px">
          <Lock size={16} aria-hidden />
        </Box>
        <Stack gap={1}>
          <Text fontWeight="medium">{TITLE}</Text>
          <Text fontSize="sm" color="fg.muted">
            {DESCRIPTION}
          </Text>
          <Text fontSize="sm" color="fg.muted">
            Missing permission: {permission}
          </Text>
          {detail ? (
            <Text fontSize="sm" color="fg.muted">
              {detail}
            </Text>
          ) : null}
        </Stack>
      </HStack>
    </Box>
  );
}
