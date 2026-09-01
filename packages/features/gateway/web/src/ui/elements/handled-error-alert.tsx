/**
 * A failure that is still true, said in place.
 *
 * The inline counterpart to the host's `failed` notice: a toast is for
 * something that just happened, an alert for a panel that is still broken.
 *
 * Harvested from `platform/app/src/features/errors/components/HandledErrorAlert.tsx`
 * with the same prop shape and the same restrained hairline, minus the two
 * things that could not travel: the code-keyed presentation registry, which
 * supplies the specific title, the remediation tips and the docs link, and
 * `ErrorActions`, which renders the copyable trace id. Both are `platform/app`
 * modules and both are a later slice. Until then a named failure reads as the
 * action that failed plus the generic line — which is exactly what the registry
 * itself answers for a code it does not list.
 *
 * The governance family carries the same element, for the same reason and
 * with the same gap. They converge when the registry moves.
 */

import { Box, HStack, Stack, Text } from "@chakra-ui/react";
import { AlertCircle } from "lucide-react";
import { UNKNOWN_ERROR_DESCRIPTION } from "../../model/describe-error";

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
