/**
 * A failure that is still true, said in place — the inline counterpart to a
 * toast (which is for something that just happened). A stripped port,
 * missing the code-keyed presentation registry and the copyable-trace-id
 * `ErrorActions` (both later `platform/app` slices), so a named failure
 * reads as the action plus the generic line until the registry moves.
 */

import { Box, HStack, Stack, Text } from "@chakra-ui/react";
import { AlertCircle } from "lucide-react";
import { UNKNOWN_ERROR_DESCRIPTION } from "../../model/describe-error.ts";

const HAIRLINE =
  "color-mix(in srgb, var(--chakra-colors-red-solid) 26%, var(--chakra-colors-border-muted))";

export interface HandledErrorAlertProps {
  /** Any error, handled or not. Renders nothing when there is none. */
  error: unknown;
  /** Headline for a failure we have no specific copy for. */
  fallbackTitle?: string;
  /** Hard override of the title. Rare. */
  title?: string;
}

export function HandledErrorAlert({ error, title, fallbackTitle }: HandledErrorAlertProps) {
  if (error === null || error === void 0) return null;

  return (
    <Box
      role="alert"
      borderWidth="1px"
      borderColor={HAIRLINE}
      borderRadius="md"
      paddingX={4}
      paddingY={3}
    >
      <HStack gap={3} alignItems="flex-start">
        <Box color="red.fg" display="flex" flexShrink={0} marginTop="2px">
          <AlertCircle size={16} aria-hidden />
        </Box>
        <Stack gap={1}>
          <Text fontWeight="medium">{title ?? fallbackTitle ?? "Something went wrong"}</Text>
          <Text fontSize="sm" color="fg.muted">
            {UNKNOWN_ERROR_DESCRIPTION}
          </Text>
        </Stack>
      </HStack>
    </Box>
  );
}
