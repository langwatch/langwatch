import { HStack, Text } from "@chakra-ui/react";
import type { SpanDetail } from "@langwatch/trace-contract";
import type { TraceEditSpanField } from "@langwatch/trace-contract";
import { CorrectedScalar } from "./corrected-field";

/**
 * The corrected name and type of the open span, above its sections.
 *
 * They have no section of their own, since the name reads as the pane's title
 * and the type as a chip, so a correction to either would otherwise be
 * invisible to a reader looking at the detail rather than at the waterfall row.
 */
export function CorrectedSpanScalars({
  changedFields,
  corrected,
  captured,
}: {
  changedFields: TraceEditSpanField[];
  corrected: SpanDetail;
  captured: SpanDetail | undefined;
}) {
  const showName = changedFields.includes("name");
  const showType = changedFields.includes("type");
  if (!showName && !showType) return null;

  return (
    <HStack
      paddingX={4}
      paddingY={2}
      gap={4}
      bg="green.subtle"
      borderBottomWidth="1px"
      borderColor="green.muted"
      flexWrap="wrap"
    >
      {showName && (
        <CorrectedScalar label="Span name" original={captured?.name ?? ""}>
          <Text textStyle="xs" color="fg.muted">
            Name
          </Text>
          <Text textStyle="xs" fontWeight="semibold">
            {corrected.name}
          </Text>
        </CorrectedScalar>
      )}
      {showType && (
        <CorrectedScalar label="Span type" original={captured?.type ?? ""}>
          <Text textStyle="xs" color="fg.muted">
            Type
          </Text>
          <Text textStyle="xs" fontWeight="semibold">
            {corrected.type}
          </Text>
        </CorrectedScalar>
      )}
    </HStack>
  );
}
