import { Badge, Span, Text, VStack } from "@langwatch/design-system/primitives";

import {
  EXAMPLE_SENT,
  EXAMPLE_STORED,
  type ExampleToken,
  type OrganizationPiiLevel,
} from "../../model/pii-redaction-level-offer.ts";

const STORED_LABELS: Record<OrganizationPiiLevel, string> = {
  essential: "Stored with Essential",
  strict: "Stored with Strict",
};

function StoredToken({ token }: { token: ExampleToken }) {
  if (token.kind === "text") return <Span>{token.text}</Span>;
  if (token.kind === "masked") {
    return (
      <Badge size="sm" variant="subtle" colorPalette="orange" fontFamily="mono">
        [{token.label}]
      </Badge>
    );
  }
  return (
    <Span
      background="red.subtle"
      color="red.fg"
      borderRadius="sm"
      paddingX={1}
      textDecoration="underline wavy"
      textDecorationColor="red.solid"
    >
      {token.text}
    </Span>
  );
}

/** One synthetic span as sent, and as the given level stores it. */
export function PiiRedactionExample({ level }: { level: OrganizationPiiLevel }) {
  return (
    <VStack align="stretch" gap={3}>
      <VStack align="stretch" gap={1}>
        <Text fontSize="xs" fontWeight="600" color="fg.muted">
          Sent (synthetic)
        </Text>
        <Text fontSize="sm" color="fg.muted">
          {EXAMPLE_SENT}
        </Text>
      </VStack>
      <VStack align="stretch" gap={1}>
        <Text fontSize="xs" fontWeight="600" color="fg.muted">
          {STORED_LABELS[level]}
        </Text>
        <Text fontSize="sm" lineHeight="1.9" data-testid={`pii-example-${level}`}>
          {EXAMPLE_STORED[level].map((token, index) => (
            <StoredToken key={index} token={token} />
          ))}
        </Text>
      </VStack>
    </VStack>
  );
}
