import { Menu } from "@langwatch/design-system/menu";
import { Popover } from "@langwatch/design-system/popover";
import { Box, HStack, IconButton, Text, VStack } from "@langwatch/design-system/primitives";
import { Check, ChevronDown, Info } from "lucide-react";

import {
  METRIC_TIP_HOW,
  METRIC_TIP_SAVED,
  metricMenuLine,
  type ListMetric,
} from "../../../model/experiments/experiment-list-metrics.ts";

const PILL = {
  textStyle: "caption",
  color: "fg.muted",
  borderWidth: "1px",
  borderColor: "border.muted",
  borderRadius: "md",
  paddingX: 1.5,
  paddingY: 0.5,
  bg: "bg.panel",
} as const;

/** "Primary metric: correct" as plain text, until the row's runs say what else it offers. */
export function PrimaryMetricLabel({ name }: { name: string }) {
  return (
    <Text textStyle="caption" color="fg.muted" lineClamp={1}>
      Primary metric:{" "}
      <Text as="span" color="fg" fontWeight="medium">
        {name}
      </Text>
    </Text>
  );
}

/** The (i) beside the control: why this metric leads, how to change it, where the pick lives. */
function MetricInfoTip({ reason }: { reason: string }) {
  return (
    <Popover.Root positioning={{ placement: "bottom-start" }}>
      <Popover.Trigger asChild>
        <IconButton
          size="2xs"
          variant="ghost"
          color="fg.muted"
          aria-label="Why this primary metric, and how to change it"
          onClick={(e) => e.stopPropagation()}
        >
          <Info size={12} />
        </IconButton>
      </Popover.Trigger>
      <Popover.Content width="300px" maxWidth="90vw" onClick={(e) => e.stopPropagation()}>
        <Popover.Body>
          <VStack align="start" gap={2} textStyle="bodySm">
            <Text>
              <Text as="span" fontWeight="medium">
                Why this one.
              </Text>{" "}
              {reason}
            </Text>
            <Text>
              <Text as="span" fontWeight="medium">
                How to change it.
              </Text>{" "}
              {METRIC_TIP_HOW}
            </Text>
            <Text color="fg.muted">{METRIC_TIP_SAVED}</Text>
          </VStack>
        </Popover.Body>
      </Popover.Content>
    </Popover.Root>
  );
}

/**
 * "Primary metric: correct" as a menu on the row: every evaluator the runs report, the default
 * marked. One line says what picking does; the reason and the browser-only note are in the (i).
 */
export function PrimaryMetricControl({
  metrics,
  metric,
  defaultKey,
  reason,
  onChoose,
}: {
  metrics: ListMetric[];
  metric: ListMetric;
  defaultKey: string | undefined;
  reason: string;
  onChoose: (key: string | undefined) => void;
}) {
  const only = metrics.length === 1;
  return (
    <HStack gap={0.5} minWidth={0} maxWidth="full">
      <Menu.Root positioning={{ placement: "bottom-start" }}>
        <Menu.Trigger
          aria-label={`Primary metric: ${metric.label}. Change`}
          onClick={(e) => e.stopPropagation()}
          minWidth={0}
        >
          <HStack gap={1} {...PILL} _hover={{ color: "fg", borderColor: "border.emphasized" }}>
            <Text as="span" flexShrink={0}>
              Primary metric:
            </Text>
            <Text as="span" color="fg" fontWeight="medium" lineClamp={1}>
              {metric.label}
            </Text>
            <ChevronDown size={11} aria-hidden />
          </HStack>
        </Menu.Trigger>
        <Menu.Content width="280px" maxWidth="90vw" onClick={(e) => e.stopPropagation()}>
          <Text textStyle="caption" color="fg.muted" paddingX={3} paddingY={2}>
            {metricMenuLine({ only })}
          </Text>
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
      <MetricInfoTip reason={reason} />
    </HStack>
  );
}
