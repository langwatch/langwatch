import { Box, Field, Input, Text } from "@chakra-ui/react";
import {
  ROUTING_HANDLE_MAX_LENGTH,
  sanitizeRoutingHandleInput,
} from "@langwatch/model-provider-contract";

import { SmallLabel } from "../elements/small-label.tsx";

/**
 * Two instances of the same provider type answer to the same family prefix, with the
 * key's chain order silently deciding which serves; this handle makes it explicit.
 */
export function ModelProviderRoutingSection({
  providerKey,
  routingHandle,
  onRoutingHandleChange,
}: {
  providerKey: string;
  routingHandle: string;
  onRoutingHandleChange: (routingHandle: string) => void;
}) {
  const prefix = routingHandle || providerKey;

  return (
    <Field.Root width="full">
      <SmallLabel>Routing handle</SmallLabel>
      <Box width="full">
        <Input
          value={routingHandle}
          // Sanitized on the way in, not flagged afterwards. A handle is
          // stored lowercased and refuses spaces, so letting "OpenRouter"
          // stand in the field promises a spelling that never reaches the
          // gateway.
          onChange={(e) => onRoutingHandleChange(sanitizeRoutingHandleInput(e.target.value))}
          placeholder={providerKey}
          width="full"
          maxLength={ROUTING_HANDLE_MAX_LENGTH}
        />
      </Box>
      <Field.HelperText>
        <Text>
          Requests reach this provider as <RoutingSpelling spelling={`${prefix}/<model>`} />
        </Text>
      </Field.HelperText>
    </Field.Root>
  );
}

/**
 * Uses a semantic token, not a fixed grey: a fixed light grey keeps its value in dark
 * mode, where it sits on muted helper text at ~1.3:1 contrast — unreadable for text the
 * reader must copy.
 */
function RoutingSpelling({ spelling }: { spelling: string }) {
  return (
    <Text
      as="code"
      fontSize="xs"
      background="bg.muted"
      color="fg"
      paddingX={1}
      rounded="sm"
      whiteSpace="nowrap"
    >
      {spelling}
    </Text>
  );
}
