/** One region the viewer does not hold permission for. Copy hardcoded pending registry. */

import { Box, HStack, Stack, Text } from "@langwatch/design-system/primitives";
import { explainHandledError } from "@langwatch/handled-error/presentation";
import { readHandledError } from "@langwatch/handled-error/read-handled-error";
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

/** The codes a server refusal for a missing grant arrives under. */
const PERMISSION_REFUSAL_CODES: ReadonlySet<string> = new Set([
  "permission_denied",
  "project_permission_denied",
  "insufficient_permissions",
]);

/** Whether a failed query was refused for a grant the viewer does not hold. */
export function isPermissionRefusal(error: unknown): boolean {
  const handled = readHandledError(error);
  return handled !== null && PERMISSION_REFUSAL_CODES.has(handled.code);
}

/**
 * The notice for a refusal the server sent, in the registry's words for it. Renders nothing for
 * any other error, so it can sit beside the error state.
 */
export function PermissionRefusedNotice({ error, detail }: { error: unknown; detail?: string }) {
  const handled = readHandledError(error);
  if (!handled || !PERMISSION_REFUSAL_CODES.has(handled.code)) return null;
  const copy = explainHandledError(handled);
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
          <Text fontWeight="medium">{copy.title}</Text>
          {copy.description ? (
            <Text fontSize="sm" color="fg.muted">
              {copy.description}
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
