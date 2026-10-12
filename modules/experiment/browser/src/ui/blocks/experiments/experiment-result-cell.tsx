import { EmptyValue } from "@langwatch/design-system/empty-value";
import { HStack, Skeleton, Text, VStack } from "@langwatch/design-system/primitives";
import type { ReactNode } from "react";

import {
  formatMetricValue,
  metricNoun,
  type ChangeInWords,
  type ResultHeadline,
} from "../../../model/experiments/experiment-list-metrics.ts";
import type { ResultState } from "../../../model/experiments/experiment-list-row-view.ts";
import { plural } from "../../../model/experiments/plural.ts";
import { ChangeChip } from "./change-chip.tsx";
import { RunSparkline } from "./run-sparkline.tsx";

const NO_HEADLINE_TEXT = {
  "no-evaluators": "No evaluators in this experiment's runs",
  "no-numeric": "No numeric results",
  "no-result": "No result yet",
} as const;

/**
 * The row's headline: the primary metric's value and what it is, the metric control, and for
 * a multi-run experiment how it moved and the run history. The same cell open or closed.
 */
export function ExperimentResultCell({
  headline,
  control,
  change,
  targets,
  sparkline,
  state,
}: {
  headline: ResultHeadline | undefined;
  /** The primary-metric control, or its plain-text stand-in while the runs load. */
  control: ReactNode;
  change: ChangeInWords | undefined;
  /** Targets in the run when there is more than one. */
  targets: number | undefined;
  sparkline: number[];
  /** What to say when there is no headline: waiting for the runs, none ran, or nothing scored. */
  state: ResultState;
}) {
  if (!headline) {
    if (state === "loading") return <Skeleton height="16px" width="96px" />;
    if (state === "no-runs") return <EmptyValue label="No runs yet" />;
    return (
      <Text textStyle="caption" color="fg.muted">
        {NO_HEADLINE_TEXT[state]}
      </Text>
    );
  }
  const { metric, value, note } = headline;
  const sub = [
    ...(change ? [`than run #${change.against}`] : []),
    ...(note ? [note] : []),
    ...(targets ? [`${targets} targets`] : []),
  ];
  return (
    <HStack gap={3} minWidth={0}>
      <VStack align="start" gap={1} flex={1} minWidth={0}>
        <HStack gap={1.5} align="baseline" minWidth={0}>
          <Text
            textStyle="sectionTitle"
            color={targets ? "fg.muted" : "fg"}
            flexShrink={0}
            fontVariantNumeric="tabular-nums"
          >
            {formatMetricValue(metric, value)}
          </Text>
          <Text textStyle="caption" color="fg.muted" lineClamp={1}>
            {metricNoun(metric)}
          </Text>
        </HStack>
        {control}
        {(change || sub.length > 0) && (
          <HStack gap={1} textStyle="caption" color="fg.muted" minWidth={0}>
            {change && <ChangeChip change={change} />}
            <Text
              as="span"
              lineClamp={1}
              title={targets ? "All targets of the run together" : undefined}
            >
              {sub.join(" · ")}
            </Text>
          </HStack>
        )}
      </VStack>
      {sparkline.length > 0 && (
        <RunSparkline
          values={sparkline}
          label={`${metricNoun(metric)} across ${plural({ count: sparkline.length, noun: "scored run" })}`}
        />
      )}
    </HStack>
  );
}
