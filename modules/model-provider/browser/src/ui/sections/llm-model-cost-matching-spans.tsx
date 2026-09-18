/**
 * Gated on `traces:view`, not the cost permission, since the preview shows
 * span metadata (model names, token counts, trace ids), not cost-rule config.
 * The row links via address, not navigation, so a new tab won't lose the mid-edit form.
 */

import { Badge, Box, chakra, HStack, Icon, Skeleton, Text, VStack } from "@chakra-ui/react";
import { formatCost, formatTokens } from "@langwatch/design-system/display-formatters";
import { ProviderIcon } from "@langwatch/model-provider-browser-kit";
import type {
  CostRuleMatchingSpansPreview,
  CostRulePreviewSampleSpan,
} from "@langwatch/model-provider-contract";
import { keepPreviousData } from "@tanstack/react-query";
import { LuExternalLink, LuMoveRight } from "react-icons/lu";

import { modelProviderApi } from "../../behavior/model-provider-api.ts";
import { useModelProviderHost } from "../../model/model-provider-host.ts";
import { formatRelativeTimeAgo } from "../../model/relative-time.ts";
import { isSafeRegex } from "../../model/safe-regex.ts";

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

function MatchSummary({ preview }: { preview: CostRuleMatchingSpansPreview }) {
  if (preview.totalMatchedSpans === 0) {
    return (
      <Text textStyle="xs" color="fg.muted">
        no matches in the last {preview.windowDays} days
      </Text>
    );
  }

  const spanWord = preview.totalMatchedSpans === 1 ? "span" : "spans";
  const modelWord = preview.matchedModels.length === 1 ? "model" : "models";

  return (
    <Text textStyle="xs" color="fg.muted">
      {`${preview.totalMatchedSpans} ${spanWord} across ${preview.matchedModels.length} ${modelWord} in the last ${preview.windowDays} days`}
    </Text>
  );
}

function SampleSpanRow({
  projectSlug,
  span,
}: {
  projectSlug: string | undefined;
  span: CostRulePreviewSampleSpan;
}) {
  return (
    <chakra.button
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
      <Text textStyle="xs" fontWeight="medium" flexShrink={0} minWidth="56px" textAlign="right">
        {span.exampleCost === null ? "\u2014" : formatCost(span.exampleCost)}
      </Text>
      <Text textStyle="xs" color="fg.subtle" flexShrink={0} minWidth="52px" textAlign="right">
        {formatRelativeTimeAgo(span.startTimeMs)}
      </Text>
      <Icon as={LuExternalLink} boxSize={3.5} color="fg.subtle" flexShrink={0} />
    </chakra.button>
  );
}

/** The dead end is also the fix: every model seen, one click away from the regex. */
function UnmatchedModels({
  onPickModel,
  preview,
}: {
  onPickModel: (model: string) => void;
  preview: CostRuleMatchingSpansPreview;
}) {
  if (preview.unmatchedModels.length === 0) {
    return (
      <Text textStyle="xs" color="fg.subtle">
        No spans with a model were recorded in this project in the last {preview.windowDays} days.
      </Text>
    );
  }

  return (
    <>
      <Text textStyle="xs" color="fg.muted">
        Models seen in this project that do not match, click one to fill the regex:
      </Text>
      <Box>
        <HStack gap={1.5} flexWrap="wrap">
          {preview.unmatchedModels.map((m) => (
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
  );
}

function PreviewBody({
  isLoading,
  onPickModel,
  preview,
  projectSlug,
  regexValid,
}: {
  isLoading: boolean;
  onPickModel: (model: string) => void;
  preview: CostRuleMatchingSpansPreview | undefined;
  projectSlug: string | undefined;
  regexValid: boolean;
}) {
  if (!regexValid) {
    return (
      <Text textStyle="xs" color="fg.subtle">
        Enter a valid regular expression to preview the spans it would match.
      </Text>
    );
  }
  if (isLoading) {
    return (
      <VStack align="stretch" gap={1}>
        <Skeleton height="28px" borderRadius="sm" />
        <Skeleton height="28px" borderRadius="sm" />
        <Skeleton height="28px" borderRadius="sm" />
      </VStack>
    );
  }
  if (!preview) {
    return (
      <Text textStyle="xs" color="fg.subtle">
        Could not load the preview.
      </Text>
    );
  }

  return (
    <>
      {preview.sampleSpans.length > 0 && (
        <VStack align="stretch" gap={1}>
          {preview.sampleSpans.map((span) => (
            <SampleSpanRow
              key={`${span.traceId}-${span.spanId}`}
              projectSlug={projectSlug}
              span={span}
            />
          ))}
        </VStack>
      )}

      {preview.totalMatchedSpans === 0 && (
        <VStack align="stretch" gap={2}>
          <UnmatchedModels onPickModel={onPickModel} preview={preview} />
        </VStack>
      )}
    </>
  );
}

/**
 * Live "which spans would this regex match" preview for the model cost
 * drawer, priced with the rates being edited so the user sees the rule
 * working before saving. No matches offers one-click exact-match fills.
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
        {data && regexValid && <MatchSummary preview={data} />}
      </HStack>

      <PreviewBody
        isLoading={preview.isLoading}
        onPickModel={onPickModel}
        preview={data}
        projectSlug={projectSlug}
        regexValid={regexValid}
      />
    </VStack>
  );
}
