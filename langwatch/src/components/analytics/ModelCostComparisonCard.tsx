import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import numeral from "numeral";
import { useMemo, useState } from "react";
import { useFilterParams } from "../../hooks/useFilterParams";
import { useModelProvidersSettings } from "../../hooks/useModelProvidersSettings";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";
import { ModelSelector } from "../ModelSelector";
import {
  estimateReferenceCost,
  referenceModelOptions,
} from "./modelCostComparison";
import { SummaryMetric } from "./SummaryMetric";

const SERIES = [
  { metric: "performance.prompt_tokens", aggregation: "sum" },
  { metric: "performance.completion_tokens", aggregation: "sum" },
  { metric: "performance.total_cost", aggregation: "sum" },
] as const;

const seriesKey = (index: number) =>
  `${index}/${SERIES[index]!.metric}/${SERIES[index]!.aggregation}`;

const sumSeries = (
  buckets: Record<string, unknown>[] | undefined,
  key: string,
): number =>
  (buckets ?? []).reduce((total, bucket) => {
    const value = bucket[key];
    return total + (typeof value === "number" ? value : 0);
  }, 0);

const money = (value: number) =>
  value >= 0.01 || value === 0
    ? numeral(value).format("$0.00a")
    : numeral(value).format("$0.0000a");

const DEFAULT_REFERENCE = "anthropic/claude-sonnet-4-6";

/**
 * Compares the period's actual spend with what the same traffic would have
 * cost on a reference model, using the period's real token counts priced
 * at the reference model's catalog rates. Honors the page's filters and
 * date range, so the comparison can be sliced by label, model, user, etc.
 */
export function ModelCostComparisonCard() {
  const { project } = useOrganizationTeamProject();
  const { filterParams, queryOpts } = useFilterParams();
  const { modelMetadata } = useModelProvidersSettings({
    projectId: project?.id,
  });

  const options = useMemo(
    () => referenceModelOptions(modelMetadata),
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
      series: SERIES.map((s) => ({ ...s })),
      timeScale: "full",
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
    queryOpts,
  );

  const promptTokens = sumSeries(timeseries.data?.currentPeriod, seriesKey(0));
  const completionTokens = sumSeries(
    timeseries.data?.currentPeriod,
    seriesKey(1),
  );
  const actualCost = sumSeries(timeseries.data?.currentPeriod, seriesKey(2));

  const pricing = selectedModel
    ? modelMetadata?.[selectedModel]?.pricing
    : undefined;
  const referenceCost = estimateReferenceCost({
    promptTokens,
    completionTokens,
    pricing,
  });
  const savings =
    referenceCost !== undefined ? referenceCost - actualCost : undefined;
  const hasTraffic = promptTokens + completionTokens > 0;

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
      {!timeseries.isLoading && !hasTraffic ? (
        <Text textStyle="sm" color="fg.subtle">
          No traffic in the selected period. Adjust the filters or date range
          to compare costs.
        </Text>
      ) : (
        <HStack align="start" gap={0}>
          <SummaryMetric
            label="Current Cost"
            current={timeseries.isLoading ? undefined : actualCost}
            format={money}
            increaseIs="neutral"
          />
          <SummaryMetric
            label="Estimated Cost on Selected Model"
            current={
              timeseries.isLoading || referenceCost === undefined
                ? undefined
                : referenceCost
            }
            format={money}
            increaseIs="neutral"
            tooltip="The period's input and output tokens priced at the selected model's rates."
          />
          <SummaryMetric
            label="Estimated Savings"
            current={
              timeseries.isLoading || savings === undefined
                ? undefined
                : savings
            }
            format={(value: number) =>
              value < 0 ? `-${money(Math.abs(value))}` : money(value)
            }
            increaseIs="good"
            tooltip="Estimated cost on the selected model minus the actual cost. Negative means the current setup costs more."
          />
        </HStack>
      )}
    </VStack>
  );
}
