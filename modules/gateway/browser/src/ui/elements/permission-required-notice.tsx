/** One region the viewer does not hold permission for. Copy hardcoded pending registry. */

import { Box, HStack, Stack, Text } from "@langwatch/design-system/primitives";
import { explainHandledError } from "@langwatch/handled-error/presentation";
import { readHandledError } from "@langwatch/handled-error/read-handled-error";
import { Lock } from "lucide-react";

import { isPermissionRefusal } from "../../model/permission-refusal.ts";

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
    <NoticeBox title={TITLE} description={DESCRIPTION} permission={permission} detail={detail} />
  );
}

/**
 * The same notice, for a refusal the server sent: the region reads as no
 * access in the registry's words, not as a failed load with a retry.
 * Renders nothing for any other error, so it can sit beside the error state.
 */
export function PermissionRefusedNotice({ error, detail }: { error: unknown; detail?: string }) {
  const handled = readHandledError(error);
  if (!handled || !isPermissionRefusal(error)) return null;
  const copy = explainHandledError(handled);
  return <NoticeBox title={copy.title} description={copy.description} detail={detail} />;
}

function NoticeBox({
  title,
  description,
  permission,
  detail,
}: {
  title: string;
  description?: string;
  permission?: string;
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
          <Text fontWeight="medium">{title}</Text>
          {description ? (
            <Text fontSize="sm" color="fg.muted">
              {description}
            </Text>
          ) : null}
          {permission ? (
            <Text fontSize="sm" color="fg.muted">
              Missing permission: {permission}
            </Text>
          ) : null}
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
