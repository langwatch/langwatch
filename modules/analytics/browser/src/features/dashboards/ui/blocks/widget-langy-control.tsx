/**
 * A widget's "Langy traces" setting, beside its queries in the editor: whether the widget counts
 * the member's conversations with Langy, "Left out" or "Included", with a one-line hint.
 * @see modules/dashboard/specs/dashboards-v2.feature AC200
 */

import { HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { SegmentedControl } from "@langwatch/design-system/segmented-control";

const LEFT_OUT = "left-out";
const INCLUDED = "included";

const HINTS = {
  [LEFT_OUT]: "This widget counts your agent's traces only.",
  [INCLUDED]: "This widget also counts your conversations with Langy.",
} as const;

export function WidgetLangyControl({
  includesLangy,
  onChange,
}: {
  includesLangy: boolean;
  onChange: (includeLangy: boolean) => void;
}) {
  const value = includesLangy ? INCLUDED : LEFT_OUT;
  return (
    <HStack justify="space-between" gap={3} data-testid="widget-langy-control">
      <VStack align="start" gap={0} minWidth={0}>
        <Text textStyle="label">Langy traces</Text>
        <Text textStyle="caption" color="fg.muted">
          {HINTS[value]}
        </Text>
      </VStack>
      <SegmentedControl
        size="xs"
        aria-label="Langy traces"
        value={value}
        onValueChange={({ value: picked }) => {
          if (picked !== value) onChange(picked === INCLUDED);
        }}
        items={[
          { value: LEFT_OUT, label: "Left out" },
          { value: INCLUDED, label: "Included" },
        ]}
      />
    </HStack>
  );
}
