import { Box, Code, HStack, Text, VStack } from "@langwatch/design-system/primitives";

import type { TestedOn } from "../../../model/experiments/experiment-list-tested-on.ts";
import { plural } from "../../../model/experiments/plural.ts";

/** What the run was tested on: distinct items, the entry fields and three example inputs. */
export function ExperimentTestedOn({
  testedOn,
  datasetName,
}: {
  testedOn: TestedOn;
  datasetName: string | undefined;
}) {
  const { items, fields, examples } = testedOn;
  return (
    <VStack align="stretch" gap={1} paddingY={2}>
      <HStack gap={1} wrap="wrap" textStyle="bodySm">
        <Text as="span" fontWeight="medium">
          Tested on
        </Text>
        {datasetName && <Text as="span">· {datasetName}</Text>}
        <Text as="span" color="fg.muted">
          · {plural({ count: items, noun: "item" })} · fields
        </Text>
        {fields.map((field) => (
          <Code key={field} size="sm" variant="subtle" color="fg.muted">
            {field}
          </Code>
        ))}
      </HStack>
      {examples.length > 0 && (
        <Text textStyle="caption" color="fg.muted">
          {examples.length} of {plural({ count: items, noun: "item" })}, spread across the set
        </Text>
      )}
      {examples.map((example, at) => {
        const line = Object.entries(example)
          .map(([key, value]) => `${key}: ${value}`)
          .join("  ·  ");
        return (
          <HStack
            key={at}
            gap={2}
            minWidth={0}
            borderWidth="1px"
            borderColor="border.muted"
            borderRadius="md"
            bg="bg.panel"
            paddingX={2}
            paddingY={1}
            textStyle="caption"
          >
            <Text as="span" color="fg.muted" flexShrink={0}>
              e.g.
            </Text>
            <Box minWidth={0} flex={1}>
              <Text fontFamily="mono" color="fg.muted" lineClamp={1} title={line}>
                {line}
              </Text>
            </Box>
          </HStack>
        );
      })}
    </VStack>
  );
}
