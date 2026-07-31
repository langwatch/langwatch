/**
 * The statistics that sit beside the matrix — the chance-agreement plot and
 * the single-figure metrics. Split out of ConfusionMatrixDrawer so the drawer
 * stays a layout, not a layout plus three presentational widgets.
 */
import { Box, HStack, Text, VStack } from "@chakra-ui/react";

import type { JudgeAnnotationCoverage } from "./buildJudgeAnnotationPairs";
import {
  type ConfidenceInterval,
  type ConfusionMatrixMetrics,
  kappaAgreementLabel,
} from "./computeConfusionMatrix";
import { formatPercent } from "./confusionMatrixDisplay";

/**
 * How much of the run these figures actually rest on, and the caveat that
 * no confidence interval can fix.
 */
export function CoverageNote({
  coverage,
}: {
  coverage: JudgeAnnotationCoverage;
}) {
  // When the lookup was capped, `totalRows` is the slice that was checked
  // rather than the whole run — say "of the rows checked" so the numerator
  // keeps meaning "annotated".
  const denominator = coverage.truncated
    ? `the ${coverage.totalRows} rows checked are annotated`
    : `${coverage.totalRows} rows annotated`;
  const conflicts = coverage.conflictingRows;

  return (
    <Box>
      <Text fontSize="sm" fontWeight="semibold">
        Confusion matrix
      </Text>
      <Text fontSize="xs" color="fg.muted">
        {coverage.annotatedRows} of {denominator}
        {conflicts > 0
          ? `; ${conflicts} row${
              conflicts === 1 ? "" : "s"
            } excluded for conflicting reviewer annotations`
          : ""}
      </Text>
      {/* The sharpest limitation of this chart, and the one no confidence
          interval can fix. Reviewers annotate what catches their eye, so the
          annotated set skews toward rows that already looked wrong. Every
          figure below describes THAT set, not the run — say so rather than
          letting the statistics imply a rigour the sample doesn't have. */}
      <Text fontSize="xs" color="fg.muted" marginTop={1}>
        Figures describe the annotated rows only. If those were picked by
        browsing for problems rather than sampled at random, they will not
        reflect the full run.
      </Text>
    </Box>
  );
}

/**
 * Accuracy and kappa, side by side and equally prominent. Accuracy alone is
 * the misreading this chart exists to prevent, so it never appears without
 * its chance-corrected counterpart.
 */
export function HeadlineMetrics({
  metrics,
}: {
  metrics: ConfusionMatrixMetrics;
}) {
  const { accuracyInterval, cohensKappa } = metrics;

  return (
    <HStack gap={10} align="start" flexWrap="wrap">
      <VStack gap={0} align="start">
        <Text fontSize="3xl" fontWeight="bold" lineHeight="1.1">
          {formatPercent(metrics.accuracy)}
        </Text>
        <Text fontSize="xs" fontWeight="semibold">
          Accuracy
        </Text>
        <Text fontSize="2xs" color="fg.muted">
          {accuracyInterval
            ? `95% CI ${formatPercent(accuracyInterval.lower)}–${formatPercent(
                accuracyInterval.upper,
              )}`
            : "—"}
        </Text>
      </VStack>

      <VStack gap={0} align="start">
        <Text fontSize="3xl" fontWeight="bold" lineHeight="1.1">
          {cohensKappa === null ? "—" : cohensKappa.toFixed(2)}
        </Text>
        <Text fontSize="xs" fontWeight="semibold">
          Cohen&apos;s κ
        </Text>
        <Text fontSize="2xs" color="fg.muted">
          {cohensKappa === null
            ? "undefined — one label used throughout"
            : `${kappaAgreementLabel(cohensKappa)} agreement`}
        </Text>
      </VStack>
    </HStack>
  );
}

/**
 * Plots accuracy against the agreement chance alone would have produced.
 *
 * This is the visual form of the kappa argument. A judge scoring 90% on a
 * set that is 90% passes has done nothing, and a bare "90%" hides that
 * completely — here the shaded floor swallows the marker and the point is
 * immediate. The confidence band is drawn at the same scale so a thin
 * sample reads as a wide, hesitant smear rather than a crisp number.
 */
export function AgreementBar({
  accuracy,
  interval,
  chance,
}: {
  accuracy: number;
  interval: ConfidenceInterval | null;
  chance: number | null;
}) {
  const asWidth = (value: number) => `${Math.min(100, value * 100)}%`;
  // Markers are positioned by their left edge inside an overflow-hidden
  // track, so at 100% an unclamped marker sits entirely in the clipped
  // region and a perfect judge shows no marker at all. Cap the offset so
  // the marker's full width stays inside the track.
  const asMarkerInset = ({
    value,
    markerWidthPx,
  }: {
    value: number;
    markerWidthPx: number;
  }) => `min(${asWidth(value)}, calc(100% - ${markerWidthPx}px))`;
  const clearsChance = chance !== null && accuracy > chance;

  return (
    <Box>
      <HStack justify="space-between" marginBottom={1.5}>
        <Text fontSize="xs" fontWeight="semibold">
          Is this better than chance?
        </Text>
        {chance !== null ? (
          <Text
            fontSize="2xs"
            fontWeight="semibold"
            color={clearsChance ? "green.fg" : "orange.fg"}
          >
            {clearsChance
              ? `+${Math.round((accuracy - chance) * 100)} pts over chance`
              : "at or below chance"}
          </Text>
        ) : null}
      </HStack>

      <Box
        position="relative"
        height="30px"
        bg="bg.muted"
        borderRadius="sm"
        borderWidth="1px"
        borderColor="border"
        overflow="hidden"
      >
        {/* Everything left of this line is free — a judge gets it for
            nothing by matching the base rate. */}
        {chance !== null ? (
          <Box
            position="absolute"
            insetStart={0}
            top={0}
            bottom={0}
            width={asWidth(chance)}
            bg="bg.emphasized"
          />
        ) : null}

        {/* Plausible range for the true accuracy, not just the point estimate. */}
        {interval ? (
          <Box
            position="absolute"
            top="7px"
            bottom="7px"
            insetStart={asWidth(interval.lower)}
            width={asWidth(interval.upper - interval.lower)}
            bg="blue.muted"
            borderRadius="sm"
          />
        ) : null}

        {chance !== null ? (
          <Box
            position="absolute"
            top={0}
            bottom={0}
            insetStart={asMarkerInset({ value: chance, markerWidthPx: 2 })}
            width="2px"
            bg="border.emphasized"
          />
        ) : null}

        <Box
          position="absolute"
          top={0}
          bottom={0}
          insetStart={asMarkerInset({ value: accuracy, markerWidthPx: 3 })}
          width="3px"
          bg="blue.solid"
        />
      </Box>

      <HStack justify="space-between" marginTop={1}>
        <Text fontSize="2xs" color="fg.muted">
          0%
        </Text>
        <Text fontSize="2xs" color="fg.muted">
          chance {formatPercent(chance)} · observed {formatPercent(accuracy)}
        </Text>
        <Text fontSize="2xs" color="fg.muted">
          100%
        </Text>
      </HStack>
    </Box>
  );
}

/**
 * The rates that read straight off the matrix. Secondary to accuracy and
 * kappa on purpose — each answers a narrower question than "can I trust
 * this judge", and a wall of equally-sized figures buries the two that do.
 */
export function SecondaryMetrics({
  metrics,
}: {
  metrics: ConfusionMatrixMetrics;
}) {
  return (
    <HStack gap={6} flexWrap="wrap">
      <Metric label="Precision" value={formatPercent(metrics.precision)} />
      <Metric label="Recall" value={formatPercent(metrics.recall)} />
      <Metric label="F1" value={formatPercent(metrics.f1)} />
      <Metric
        label="False Positive Rate"
        value={formatPercent(metrics.falsePositiveRate)}
      />
      <Metric
        label="Reviewer pass rate"
        value={formatPercent(metrics.prevalence)}
      />
    </HStack>
  );
}

export function Metric({ label, value }: { label: string; value: string }) {
  return (
    <VStack gap={0} align="start">
      <Text fontSize="lg" fontWeight="bold">
        {value}
      </Text>
      <Text fontSize="2xs" color="fg.muted">
        {label}
      </Text>
    </VStack>
  );
}
