import { HStack, Input, NativeSelect, Text, VStack } from "@chakra-ui/react";
import { useCallback, useMemo } from "react";
import { type SpanTypes, spanTypesSchema } from "~/server/tracer/types";
import {
  selectSpanEditBaseline,
  useTraceEditStore,
} from "../../../stores/traceEditStore";

const SPAN_TYPES: SpanTypes[] = spanTypesSchema.options.map((option) => option.value);

function isSpanType(value: string): value is SpanTypes {
  return (SPAN_TYPES as string[]).includes(value);
}

/**
 * Name and type editor for the selected span, above its accordions. Both live
 * on the span row rather than inside a section because they are what the
 * reviewer is correcting most often: a tool call named after its handler
 * instead of the tool, or a step recorded with the wrong kind.
 */
export function SpanNameTypeEditor({
  spanId,
  capturedName,
  capturedType,
}: {
  spanId: string;
  capturedName: string;
  capturedType: string | null;
}) {
  const basePatch = useTraceEditStore((s) => s.basePatch);
  const draft = useTraceEditStore((s) => s.spanDrafts[spanId]);
  const setSpanName = useTraceEditStore((s) => s.setSpanName);
  const setSpanType = useTraceEditStore((s) => s.setSpanType);

  // A correction already stored for this span is what the editors start from,
  // so a second reviewer opening the same trace reads the corrected name rather
  // than reverting it the moment they touch the field.
  const baseline = useMemo(
    () => selectSpanEditBaseline({ basePatch, spanId }),
    [basePatch, spanId],
  );
  const baselineName = baseline.name ?? capturedName;
  const baselineType = baseline.type ?? capturedType ?? "span";

  const name = draft?.name ?? baselineName;
  const type = draft?.type ?? baselineType;

  const handleNameChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) =>
      setSpanName({ spanId, name: event.target.value, baselineName }),
    [setSpanName, spanId, baselineName],
  );

  const handleTypeChange = useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => {
      const next = event.target.value;
      if (isSpanType(next)) setSpanType({ spanId, type: next, baselineType });
    },
    [setSpanType, spanId, baselineType],
  );

  return (
    <HStack
      paddingX={4}
      paddingY={2}
      gap={3}
      align="flex-end"
      bg="bg.subtle"
      borderBottomWidth="1px"
      borderColor="border.muted"
    >
      <VStack align="stretch" gap={1} flex={1} minWidth={0}>
        <Text textStyle="2xs" color="fg.muted" fontWeight="semibold">
          Span name
        </Text>
        <Input
          size="xs"
          aria-label="Span name"
          value={name}
          onChange={handleNameChange}
        />
      </VStack>
      <VStack align="stretch" gap={1} width="180px" flexShrink={0}>
        <Text textStyle="2xs" color="fg.muted" fontWeight="semibold">
          Span type
        </Text>
        <NativeSelect.Root size="xs">
          <NativeSelect.Field
            aria-label="Span type"
            value={type}
            onChange={handleTypeChange}
          >
            {/* A span recorded with a type this build does not know still has
                to show what it is, so the captured value joins the list. */}
            {!isSpanType(type) && <option value={type}>{type}</option>}
            {SPAN_TYPES.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </NativeSelect.Field>
          <NativeSelect.Indicator />
        </NativeSelect.Root>
      </VStack>
    </HStack>
  );
}
