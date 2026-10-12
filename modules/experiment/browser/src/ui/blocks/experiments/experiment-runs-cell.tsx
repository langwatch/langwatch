import { Text, VStack } from "@langwatch/design-system/primitives";

import { plural } from "../../../model/experiments/plural.ts";

/** "12 runs", and under it "200 items · 2 targets" where the data has both. */
export function ExperimentRunsCell({
  runs,
  items,
  targets,
}: {
  runs: number;
  items: number | undefined;
  targets: number | undefined;
}) {
  return (
    <VStack align="start" gap={0}>
      <Text textStyle="bodySm">{plural({ count: runs, noun: "run" })}</Text>
      {items !== undefined && targets !== undefined && (
        <Text textStyle="caption" color="fg.muted" whiteSpace="nowrap">
          {plural({ count: items, noun: "item" })} · {plural({ count: targets, noun: "target" })}
        </Text>
      )}
    </VStack>
  );
}
