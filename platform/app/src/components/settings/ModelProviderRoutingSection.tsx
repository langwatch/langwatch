import { Box, Field, Input, Text } from "@chakra-ui/react";
import {
  ROUTING_HANDLE_MAX_LENGTH,
  sanitizeRoutingHandleInput,
} from "../../server/modelProviders/routingHandle";
import { SmallLabel } from "../SmallLabel";

/**
 * How a request reaches THIS provider.
 *
 * Two instances of the same provider type answer to the same family prefix,
 * and the one that serves a request is decided by the key's chain order, which
 * nothing in the product used to say. This section says it, and gives the
 * operator the one control that makes it explicit: a routing handle that names
 * this instance and nothing else.
 *
 * The helper shows one sentence and updates as the operator types, so the
 * spelling they are creating is on screen while they create it. The provider
 * type is the placeholder, because it is what the field falls back to.
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
          onChange={(e) =>
            onRoutingHandleChange(sanitizeRoutingHandleInput(e.target.value))
          }
          placeholder={providerKey}
          width="full"
          maxLength={ROUTING_HANDLE_MAX_LENGTH}
        />
      </Box>
      <Field.HelperText>
        <Text>
          Requests reach this provider as{" "}
          <RoutingSpelling spelling={`${prefix}/<model>`} />
        </Text>
      </Field.HelperText>
    </Field.Root>
  );
}

/**
 * One addressable spelling, set apart from the sentence around it.
 *
 * The background is a semantic token rather than a fixed grey. A fixed light
 * grey keeps its value in dark mode, where the muted helper-text colour sits on
 * top of it at about 1.3:1, so the spelling becomes unreadable. It is the one
 * part of this sentence a reader has to copy, so it has to stay legible in both
 * themes.
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
