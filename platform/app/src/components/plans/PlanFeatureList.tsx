import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { Check } from "lucide-react";
import type { PlanFeatures } from "./planFeatureGroups";

/**
 * What a column includes, read as a structure rather than as a run of ticks.
 *
 * Three levels, and no more: the line that says the column is additive, the
 * headings a long column needs to be scannable, and the bullets. The tick is
 * punctuation — it is set quiet, and the words carry the weight — because a
 * column of twelve coloured marks is a column of twelve coloured marks
 * whatever it says beside them.
 */
export function PlanFeatureList({
  features,
  accent,
}: {
  features: PlanFeatures;
  /** True on the card the row is pointing at: its inheritance line is inked. */
  accent: boolean;
}) {
  return (
    <VStack align="stretch" gap={0} width="full">
      {features.inherits ? (
        <Box
          paddingBottom={3}
          marginBottom={3}
          borderBottomWidth={1}
          borderColor="border.subtle"
        >
          <Text
            fontSize="13px"
            fontWeight="600"
            letterSpacing="-0.005em"
            color={accent ? "auth.ink" : "fg"}
          >
            {features.inherits}
          </Text>
        </Box>
      ) : null}

      <VStack align="stretch" gap={0}>
        {features.groups.map((group, groupIndex) => (
          <Box key={group.label ?? "all"} marginTop={groupIndex === 0 ? 0 : 4}>
            {group.label ? (
              <Text
                fontSize="10px"
                fontWeight="700"
                textTransform="uppercase"
                letterSpacing="0.1em"
                color="fg.subtle"
                marginBottom={2}
              >
                {group.label}
              </Text>
            ) : null}
            <VStack align="stretch" gap="7px">
              {group.features.map((feature) => (
                <HStack key={feature} align="start" gap={2}>
                  <Box
                    color="fg.subtle"
                    flexShrink={0}
                    lineHeight={0}
                    paddingTop="4px"
                  >
                    <Check size={13} strokeWidth={2.5} />
                  </Box>
                  <Text fontSize="13.5px" lineHeight="1.5" color="fg">
                    {feature}
                  </Text>
                </HStack>
              ))}
            </VStack>
          </Box>
        ))}
      </VStack>
    </VStack>
  );
}
