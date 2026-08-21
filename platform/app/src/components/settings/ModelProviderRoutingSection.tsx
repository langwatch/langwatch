import { Box, Field, Input, Text } from "@chakra-ui/react";
import { ROUTING_HANDLE_MAX_LENGTH } from "../../server/modelProviders/routingHandle";
import { SmallLabel } from "../SmallLabel";

/**
 * How a request reaches THIS provider.
 *
 * Two instances of the same provider type answer to the same family prefix,
 * and the one that serves a request is decided by the key's chain order, which
 * nothing in the product used to say. This section says it, and gives the
 * operator the one control that makes it explicit: a routing handle that names
 * this instance and nothing else.
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
  const handle = routingHandle.trim().toLowerCase();

  return (
    <Field.Root width="full">
      <SmallLabel>Routing handle</SmallLabel>
      <Box width="full">
        <Input
          value={routingHandle}
          onChange={(e) => onRoutingHandleChange(e.target.value)}
          placeholder="For example: europe"
          width="full"
          maxLength={ROUTING_HANDLE_MAX_LENGTH}
        />
      </Box>
      <Field.HelperText>
        <Text>
          Requests reach this provider as{" "}
          <RoutingSpelling spelling={`${providerKey}/<model>`} />
          {handle ? (
            <>
              {" or "}
              <RoutingSpelling spelling={`${handle}/<model>`} />
            </>
          ) : null}
          , or by the exact model name when this provider is the one that serves
          it.
        </Text>
      </Field.HelperText>
      <Field.HelperText>
        {handle
          ? "A handle names this provider only, so requests reach it even when another provider of the same type is also available. Changing the handle stops requests that use the old one."
          : "A handle is optional. Set one when you have more than one provider of this type and you want to choose between them in the request."}
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
