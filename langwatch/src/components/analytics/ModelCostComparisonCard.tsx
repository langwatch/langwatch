import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import numeral from "numeral";
import { useMemo, useState } from "react";
import { useFilterParams } from "../../hooks/useFilterParams";
import { useModelProvidersSettings } from "../../hooks/useModelProvidersSettings";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import type { SeriesInputType } from "../../server/analytics/registry";
import { readSummaryMetric } from "../../server/analytics/timeseriesSummary";
import { api } from "../../utils/api";
import { ModelSelector } from "../ModelSelector";
import {
  estimateReferenceCost,
  referenceModelOptions,
} from "./modelCostComparison";
import { SummaryMetric } from "./SummaryMetric";

/**
 * The four token buckets the product bills separately, plus the recorded cost.
 * Cached input is counted apart from fresh input, so leaving the cache buckets
 * out of the request would price a cached period as if most of its prompt never
 * happened. Values are read back by metric name, never by position.
 */
const SERIES: SeriesInputType[] = [
  { metric: "performance.prompt_tokens", aggregation: "sum" },
  { metric: "performance.completion_tokens", aggregation: "sum" },
  { metric: "performance.cache_read_tokens", aggregation: "sum" },
  { metric: "performance.cache_write_tokens", aggregation: "sum" },
  { metric: "performance.total_cost", aggregation: "sum" },
];

const money = (value: number) =>
  value >= 0.01 || value === 0
    ? numeral(value).format("$0.00a")
    : numeral(value).format("$0.0000a");

const signedMoney = (value: number) =>
  value < 0 ? `-${money(Math.abs(value))}` : money(value);

const tokenCount = (value: number) => numeral(value).format("0.[0]a");

const DEFAULT_REFERENCE = "anthropic/claude-sonnet-4-6";

/**
 * Compares the period's actual spend with what the same traffic would have cost
 * on a reference model, using the period's real token counts priced at the
 * reference model's catalog rates. Honors the page's filters and date range, so
 * the comparison can be sliced by label, model, user, etc.
 *
 * The card shows nothing rather than a number it cannot stand behind: a model
 * with no published price gets a plain explanation, not a $0 estimate.
 */
export function ModelCostComparisonCard() {
  const { project } = useOrganizationTeamProject();
  const { filterParams, queryOpts } = useFilterParams();
  const { modelMetadata, isLoading: isLoadingModels } =
    useModelProvidersSettings({ projectId: project?.id });

  const options = useMemo(
    () => referenceModelOptions({ modelMetadata }),
    [modelMetadata],
  );
  const [referenceModel, setReferenceModel] = useState<string | undefined>(
    undefined,
  );
  const selectedModel =
    referenceModel ??
    (options.includes(DEFAULT_REFERENCE) ? DEFAULT_REFERENCE : options[0]);

  const timeseries = api.analytics.getTimeseries.useQuery(
    {
      ...filterParams,
      series: SERIES,
      timeScale: "full",
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    queryOpts,
  );

  const buckets = timeseries.data?.currentPeriod;
  const read = (metric: string) =>
    readSummaryMetric({ buckets, series: SERIES, metric, aggregation: "sum" }) ??
    0;

  const promptTokens = read("performance.prompt_tokens");
  const completionTokens = read("performance.completion_tokens");
  const cacheReadTokens = read("performance.cache_read_tokens");
  const cacheWriteTokens = read("performance.cache_write_tokens");
  const actualCost = read("performance.total_cost");

  const referenceCost = estimateReferenceCost({
    promptTokens,
    completionTokens,
    cacheReadTokens,
    cacheWriteTokens,
    pricing: selectedModel ? modelMetadata?.[selectedModel]?.pricing : undefined,
  });
  const savings =
    referenceCost !== undefined ? referenceCost - actualCost : undefined;

  // The query reports `isLoading` as false while it is still disabled (no
  // project or no date range yet), so the presence of data is what tells
  // loading apart from a genuinely quiet period. Without this the card claims
  // "no traffic" before it has even asked.
  const isLoaded = !isLoadingModels && buckets !== undefined;
  const hasTraffic =
    promptTokens + completionTokens + cacheReadTokens + cacheWriteTokens > 0;
  const cachedTokens = cacheReadTokens + cacheWriteTokens;

  // Formatted up front so a value that cannot be estimated reads as a dash
  // with an explanation underneath, rather than a skeleton that promises a
  // number still on its way.
  const asIs = (value: string) => value;
  const cell = (value: number | undefined, format: (value: number) => string) =>
    !isLoaded ? undefined : value === undefined ? "-" : format(value);

  return (
    <VStack align="stretch" gap={4}>
      <HStack justify="space-between" flexWrap="wrap" gap={2}>
        <Text textStyle="sm" color="fg.muted">
          What the same traffic would cost on
        </Text>
        <Box minWidth="220px">
          {selectedModel && (
            <ModelSelector
              model={selectedModel}
              options={options}
              onChange={setReferenceModel}
              size="sm"
              mode="chat"
            />
          )}
        </Box>
      </HStack>
      {timeseries.isError ? (
        <Text textStyle="sm" color="fg.error">
          Could not load usage for the selected period. Try refreshing the page.
        </Text>
      ) : isLoaded && !hasTraffic ? (
        <Text textStyle="sm" color="fg.subtle">
          No traffic in the selected period. Adjust the filters or date range to
          compare costs.
        </Text>
      ) : (
        <VStack align="stretch" gap={2}>
          <HStack align="start" gap={0}>
            <SummaryMetric
              label="Actual Cost"
              current={cell(actualCost, money)}
              format={asIs}
              increaseIs="neutral"
              tooltip="What this period's traffic cost, across every model in it. Models with no published price, self-hosted ones included, are recorded at $0."
              zeroMeansNoData={false}
            />
            <SummaryMetric
              label="Estimated Cost"
              current={cell(referenceCost, money)}
              format={asIs}
              increaseIs="neutral"
              tooltip="Every input, output and cached token recorded in this period, priced at the selected model's published rates."
              zeroMeansNoData={false}
            />
            <SummaryMetric
              label="Estimated Savings"
              current={cell(savings, signedMoney)}
              format={asIs}
              increaseIs="good"
              tooltip="Estimated cost on the selected model minus the actual cost. Negative means the current setup costs more."
              zeroMeansNoData={false}
            />
          </HStack>
          {isLoaded && referenceCost === undefined && (
            <Text textStyle="xs" color="fg.subtle">
              {selectedModel
                ? `No published price for ${selectedModel}, so this period cannot be repriced with it. Pick another model to compare.`
                : "No model with a published price is available to compare against."}
            </Text>
          )}
          {isLoaded && referenceCost !== undefined && (
            <Text textStyle="xs" color="fg.subtle">
              Based on {tokenCount(promptTokens)} input and{" "}
              {tokenCount(completionTokens)} output tokens
              {cachedTokens > 0
                ? `, plus ${tokenCount(cachedTokens)} cached`
                : ""}{" "}
              recorded in this period.
            </Text>
          )}
        </VStack>
      )}
    </VStack>
  );
}
