import { Alert, Code, Text } from "@langwatch/design-system/primitives";
import type { TruncatedAttribute } from "@langwatch/trace-contract";

import { formatBytes } from "../../../../../model/display-formatters.ts";

const SURFACE_LABELS: Record<NonNullable<TruncatedAttribute["on"]>, string> = {
  event: "on an event",
  link: "on a link",
  resource: "on the resource",
};

/**
 * Says which attribute values on the span were too large to store and were cut, with each
 * original size, so a placeholder in their place never reads as what was sent.
 */
export function TruncatedAttributesNotice({
  attributes,
}: {
  attributes?: readonly TruncatedAttribute[] | null;
}) {
  if (!attributes || attributes.length === 0) return null;
  return (
    <Alert.Root status="warning" size="sm" width="full" data-testid="truncated-attributes-notice">
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Description>
          <Text as="span">
            Some values on this span were too large to store and were cut. A placeholder shows in
            their place:{" "}
          </Text>
          {attributes.map((attribute, index) => (
            <Text as="span" key={`${index}:${attribute.on ?? "span"}:${attribute.key}`}>
              {index > 0 && ", "}
              <Code size="sm">{attribute.key}</Code> ({formatBytes(attribute.bytes)}
              {attribute.on ? ` ${SURFACE_LABELS[attribute.on]}` : ""})
            </Text>
          ))}
        </Alert.Description>
      </Alert.Content>
    </Alert.Root>
  );
}
