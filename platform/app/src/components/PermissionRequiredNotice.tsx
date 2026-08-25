import { Box, HStack, Stack, Text } from "@chakra-ui/react";
import { Lock } from "lucide-react";

import { explainHandledError } from "~/features/errors";
import type { Permission } from "~/server/api/rbac";

/**
 * One region of a page the viewer does not hold the permission for.
 *
 * The inline counterpart to {@link PermissionAlert}, which takes the whole page
 * down. A dashboard built from panels with different permissions behind them
 * needs the smaller unit: the panels the viewer can read still render, and the
 * one they cannot says which grant is missing instead of showing a zero.
 *
 * The words come from the `insufficient_permissions` entry in the client
 * presentation registry, keyed by code exactly as a server refusal is, so the
 * panel reads the same whether the client predicted the refusal or the server
 * sent one. See `dev/docs/best_practices/error-handling.md` and ADR-045.
 *
 * Not an error state: nothing failed, so the tone is muted and there is no
 * error id to quote. A query that fails anyway still renders
 * `HandledErrorAlert`.
 */
export function PermissionRequiredNotice({
  permission,
  detail,
}: {
  /** The grant the panel needs, named back to the reader verbatim. */
  permission: Permission;
  /** One extra line about what stays hidden without it. Optional. */
  detail?: string;
}) {
  const copy = explainHandledError({
    code: "insufficient_permissions",
    meta: { required_permission: permission },
    httpStatus: 403,
    fault: "customer",
    retryable: false,
    tips: [],
    docsUrl: undefined,
    traceId: undefined,
    reasons: [],
  });

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
          <Lock size={14} aria-hidden="true" />
        </Box>
        <Stack gap={0.5} flex="1" minWidth={0}>
          <Text fontSize="sm" fontWeight="medium">
            {copy.title}
          </Text>
          {copy.description && (
            <Text fontSize="xs" color="fg.muted">
              {copy.description}
            </Text>
          )}
          {detail && (
            <Text fontSize="xs" color="fg.muted">
              {detail}
            </Text>
          )}
        </Stack>
      </HStack>
    </Box>
  );
}
