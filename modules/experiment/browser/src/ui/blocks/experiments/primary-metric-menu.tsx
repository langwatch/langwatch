import { Menu } from "@langwatch/design-system/menu";
import { Box, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { Check, ChevronDown } from "lucide-react";

import type { ListMetric } from "../../../model/experiments/experiment-list-metrics.ts";

/**
 * "Primary metric: correct" as a menu on the row: every evaluator the runs report, the default
 * marked, and why the default was picked. The pick is the person's, kept in this browser.
 */
export function PrimaryMetricMenu({
  metrics,
  metric,
  defaultKey,
  reason,
  onChoose,
}: {
  metrics: ListMetric[];
  metric: ListMetric | undefined;
  defaultKey: string | undefined;
  reason: string;
  onChoose: (key: string | undefined) => void;
}) {
  if (!metric) return null;
  const only = metrics.length === 1;
  return (
    <Menu.Root positioning={{ placement: "bottom-start" }}>
      <Menu.Trigger
        aria-label={`Primary metric: ${metric.label}. Change`}
        onClick={(e) => e.stopPropagation()}
      >
        <HStack gap={1} color="fg.muted" textStyle="caption" _hover={{ color: "fg" }}>
          <Text as="span">Primary metric:</Text>
          <Text as="span" color="fg" fontWeight="medium" lineClamp={1}>
            {metric.label}
          </Text>
          <ChevronDown size={12} />
        </HStack>
      </Menu.Trigger>
      <Menu.Content width="320px" maxWidth="90vw" onClick={(e) => e.stopPropagation()}>
        <VStack align="start" gap={1} paddingX={3} paddingY={2} whiteSpace="normal">
          <Text textStyle="caption" color="fg.muted">
            {reason}
          </Text>
          <Text textStyle="caption" color="fg.muted">
            {only
              ? "It is the only evaluator in this experiment."
              : "Your pick is saved in this browser only."}
          </Text>
        </VStack>
        {!only &&
          (["passRate", "score"] as const).map((kind) => {
            const group = metrics.filter((candidate) => candidate.kind === kind);
            return group.length === 0 ? null : (
              <Menu.ItemGroup
                key={kind}
                title={kind === "passRate" ? "Pass rate" : "Average score"}
              >
                {group.map((candidate) => (
                  <Menu.Item
                    key={candidate.key}
                    value={candidate.key}
                    aria-checked={candidate.key === metric.key}
                    onClick={(e) => {
                      e.stopPropagation();
                      onChoose(candidate.key === defaultKey ? undefined : candidate.key);
                    }}
                  >
                    <Box width="14px">{candidate.key === metric.key && <Check size={14} />}</Box>
                    {candidate.label}
                    {candidate.key === defaultKey ? " (default)" : ""}
                  </Menu.Item>
                ))}
              </Menu.ItemGroup>
            );
          })}
      </Menu.Content>
    </Menu.Root>
  );
}
