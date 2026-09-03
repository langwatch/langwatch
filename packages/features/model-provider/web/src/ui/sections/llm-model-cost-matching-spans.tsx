/**
 * The live "which spans would this rule match" preview under the regex field.
 *
 * RECOVERED FROM
 * `platform/app/src/components/settings/LLMModelCostMatchingSpans.tsx`, deleted
 * in `cc91631cd8` with the drawer it sits inside.
 *
 * WHAT IT IS FOR: a cost rule is a regular expression matched against whatever
 * string the collector recorded as the model, and the two are easy to get
 * subtly wrong. Showing the spans the rule would match, priced at the rates
 * being typed, is what turns "I think this is right" into "I can see it is".
 * When nothing matches, the models the project HAS seen are offered as
 * one-click exact-match fills, so the dead end is also the fix.
 *
 * THE PREVIEW IS GATED ON `traces:view`, not on the cost permission: the answer
 * carries span metadata — model names, token counts, trace ids — rather than
 * cost-rule configuration. A reader who may edit costs but not read traces gets
 * the form without the preview, which is the correct degradation.
 *
 * The row's deep link writes the trace drawer's own address rather than
 * navigating, because it opens in a new tab: the reader is mid-edit and must
 * not lose the form.
 */

import { Badge, Box, chakra, HStack, Icon, Skeleton, Text, VStack } from "@chakra-ui/react";
import { keepPreviousData } from "@tanstack/react-query";
import { LuExternalLink, LuMoveRight } from "react-icons/lu";

import { formatCost, formatTokens } from "@langwatch/design-system/display-formatters";

import { modelProviderApi } from "../../behavior/model-provider-api";
import { formatRelativeTimeAgo } from "../../model/relative-time";
import { isSafeRegex } from "../../model/safe-regex";
import { useModelProviderHost } from "../../model/model-provider-host";
import { ProviderIcon } from "../elements/modelProviders/icons-map";

export interface MatchingSpansPreviewInput {
  regex: string;
  model?: string;
  inputCostPerToken?: number;
  outputCostPerToken?: number;
  cacheReadCostPerToken?: number;
  cacheCreationCostPerToken?: number;
  cacheCreation1hCostPerToken?: number;
}

/**
 * Deep link that opens the traces explorer with the trace drawer already on
 * this span, the same `drawer.*` params the drawer serializes itself.
 */
function traceDrawerUrl(
  projectSlug: string,
  span: { traceId: string; spanId: string; startTimeMs: number },
): string {
  const params = new URLSearchParams({
    "drawer.open": "traceV2Details",
    "drawer.traceId": span.traceId,
    "drawer.t": String(span.startTimeMs),
    "drawer.span": span.spanId,
    "drawer.mode": "trace",
  });
  return `/${projectSlug}/traces?${params.toString()}`;
}

function TokenPair({
  inputTokens,
  outputTokens,
}: {
  inputTokens: number | null;
  outputTokens: number | null;
}) {
  if (inputTokens === null && outputTokens === null) {
    return (
      <Text textStyle="xs" color="fg.subtle" flexShrink={0}>
        no tokens
      </Text>
    );
  }
  return (
    <HStack gap={1} flexShrink={0} fontFamily="mono">
      <Text textStyle="xs" color="fg.muted">
        {formatTokens(inputTokens ?? 0)}
      </Text>
      <Icon as={LuMoveRight} boxSize={3} color="fg.subtle" />
      <Text textStyle="xs" color="fg.muted">
        {formatTokens(outputTokens ?? 0)}
      </Text>
    </HStack>
  );
}

/**
 * Live "which spans would this regex match" preview for the model cost
 * drawer. Reads recent spans from the current project and prices them with
 * the rates being edited, so the user sees the rule working (or not) before
 * saving. Rows open the trace drawer in a new tab; when nothing matches,
 * the recently-seen models are offered as one-click exact-match fills.
 */
export function LLMModelCostMatchingSpans({
  input,
  onPickModel,
}: {
  input: MatchingSpansPreviewInput;
  onPickModel: (model: string) => void;
}) {
  const { projectId, projectSlug } = useModelProviderHost().scope();
  const regexValid = input.regex.length > 0 && isSafeRegex(input.regex);

  const preview = modelProviderApi.llmModelCost.previewMatchingSpans.useQuery(
    {
      projectId: projectId ?? "",
      regex: input.regex,
      model: input.model ?? undefined,
      inputCostPerToken: input.inputCostPerToken,
      outputCostPerToken: input.outputCostPerToken,
      cacheReadCostPerToken: input.cacheReadCostPerToken,
      cacheCreationCostPerToken: input.cacheCreationCostPerToken,
      cacheCreation1hCostPerToken: input.cacheCreation1hCostPerToken,
    },
    {
      enabled: !!projectId && regexValid,
      placeholderData: keepPreviousData,
      staleTime: 30_000,
    },
  );

  const data = preview.data;

  return (
    <VStack
      align="stretch"
      gap={2}
      marginTop={3}
      padding={3}
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="md"
      bg="bg.subtle"
      data-testid="matching-spans-preview"
    >
      <HStack justify="space-between" gap={2}>
        <Text textStyle="xs" fontWeight="semibold" color="fg.muted">
          Matching spans
        </Text>
        {data && regexValid && (
          <Text textStyle="xs" color="fg.muted">
            {data.totalMatchedSpans === 0
              ? `no matches in the last ${data.windowDays} days`
              : `${data.totalMatchedSpans} span${
                  data.totalMatchedSpans === 1 ? "" : "s"
                } across ${data.matchedModels.length} model${
                  data.matchedModels.length === 1 ? "" : "s"
                } in the last ${data.windowDays} days`}
          </Text>
        )}
      </HStack>

      {!regexValid ? (
        <Text textStyle="xs" color="fg.subtle">
          Enter a valid regular expression to preview the spans it would match.
        </Text>
      ) : preview.isLoading ? (
        <VStack align="stretch" gap={1}>
          <Skeleton height="28px" borderRadius="sm" />
          <Skeleton height="28px" borderRadius="sm" />
          <Skeleton height="28px" borderRadius="sm" />
        </VStack>
      ) : !data ? (
        <Text textStyle="xs" color="fg.subtle">
          Could not load the preview.
        </Text>
      ) : (
        <>
          {data.sampleSpans.length > 0 && (
            <VStack align="stretch" gap={1}>
              {data.sampleSpans.map((span) => (
                <chakra.button
                  key={`${span.traceId}-${span.spanId}`}
                  type="button"
                  display="flex"
                  alignItems="center"
                  gap={2}
                  paddingX={2}
                  paddingY={1.5}
                  borderRadius="sm"
                  bg="transparent"
                  cursor="pointer"
                  textAlign="left"
                  _hover={{ bg: "bg.emphasized" }}
                  title="Open trace in a new tab"
                  onClick={() => {
                    if (!projectSlug) return;
                    window.open(traceDrawerUrl(projectSlug, span), "_blank", "noopener,noreferrer");
                  }}
                  data-testid="matching-span-row"
                >
                  <Badge
                    size="sm"
                    variant="subtle"
                    colorPalette="gray"
                    gap={1.5}
                    paddingX={2}
                    fontWeight="medium"
                    flexShrink={0}
                    maxWidth="45%"
                  >
                    <ProviderIcon model={span.model} size="compact" />
                    <Text fontFamily="mono" textStyle="xs" truncate>
                      {span.model}
                    </Text>
                  </Badge>
                  <Text textStyle="xs" color="fg.muted" truncate flex={1} minWidth={0}>
                    {span.spanName}
                  </Text>
                  <TokenPair inputTokens={span.inputTokens} outputTokens={span.outputTokens} />
                  <Text
                    textStyle="xs"
                    fontWeight="medium"
                    flexShrink={0}
                    minWidth="56px"
                    textAlign="right"
                  >
                    {span.exampleCost === null ? "—" : formatCost(span.exampleCost)}
                  </Text>
                  <Text
                    textStyle="xs"
                    color="fg.subtle"
                    flexShrink={0}
                    minWidth="52px"
                    textAlign="right"
                  >
                    {formatRelativeTimeAgo(span.startTimeMs)}
                  </Text>
                  <Icon as={LuExternalLink} boxSize={3.5} color="fg.subtle" flexShrink={0} />
                </chakra.button>
              ))}
            </VStack>
          )}

          {data.totalMatchedSpans === 0 && (
            <VStack align="stretch" gap={2}>
              {data.unmatchedModels.length > 0 ? (
                <>
                  <Text textStyle="xs" color="fg.muted">
                    Models seen in this project that do not match, click one to fill the regex:
                  </Text>
                  <Box>
                    <HStack gap={1.5} flexWrap="wrap">
                      {data.unmatchedModels.map((m) => (
                        <Badge
                          key={m.model}
                          asChild
                          size="sm"
                          variant="outline"
                          cursor="pointer"
                          gap={1.5}
                          _hover={{ bg: "bg.emphasized" }}
                        >
                          <button
                            type="button"
                            onClick={() => onPickModel(m.model)}
                            data-testid="unmatched-model-chip"
                          >
                            <ProviderIcon model={m.model} size="compact" />
                            <Text fontFamily="mono" textStyle="xs">
                              {m.model}
                            </Text>
                            <Text textStyle="2xs" color="fg.subtle">
                              {m.spanCount}
                            </Text>
                          </button>
                        </Badge>
                      ))}
                    </HStack>
                  </Box>
                </>
              ) : (
                <Text textStyle="xs" color="fg.subtle">
                  No spans with a model were recorded in this project in the last {data.windowDays}{" "}
                  days.
                </Text>
              )}
            </VStack>
          )}
        </>
      )}
    </VStack>
  );
}
