/** Permission required notice with muted tone; not an error state. */

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
