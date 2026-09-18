/** Inline error alert for panels with unresolved errors; inline counterpart to toasts. */

import { Box, HStack, Stack, Text } from "@chakra-ui/react";
import { AlertCircle } from "lucide-react";

const HAIRLINE =
  "color-mix(in srgb, var(--chakra-colors-red-solid) 26%, var(--chakra-colors-border-muted))";

const UNKNOWN_DESCRIPTION = "Something went wrong on our side. Try again in a moment.";

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
            {UNKNOWN_DESCRIPTION}
          </Text>
        </Stack>
      </HStack>
    </Box>
  );
}
