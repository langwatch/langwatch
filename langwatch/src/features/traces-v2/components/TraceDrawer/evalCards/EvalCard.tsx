import {
  Box,
  Button,
  chakra,
  Flex,
  HStack,
  Icon,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import { type ReactNode, useState } from "react";
import { LuCircleAlert, LuCircleSlash, LuQuote } from "react-icons/lu";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { AZURE_SAFETY_NOT_CONFIGURED_MESSAGE } from "~/server/app-layer/evaluations/azure-safety-env";
import { formatCost, formatDuration } from "../../../utils/formatters";
import { RunHistorySparkline } from "./RunHistorySparkline";
import { useEvalInputs } from "./useEvalInputs";
import { type EvalEntry, formatInputValue, isNoVerdict, STATUS } from "./utils";

export function EvalCard({
  eval_,
  onSelectSpan,
}: {
  eval_: EvalEntry;
  onSelectSpan?: (spanId: string) => void;
}) {
  const { name, score, scoreType, status } = eval_;
  const tone = STATUS[status] ?? STATUS.warning;
  const noVerdict = isNoVerdict(status);
  const { project, organization } = useOrganizationTeamProject();

  let scoreLabel = "";
  let scoreSubLabel = "";
  let barFill = 0;

  if (!noVerdict) {
    if (scoreType === "boolean") {
      scoreLabel = score === true ? "PASS" : "FAIL";
      barFill = score === true ? 100 : 0;
    } else if (scoreType === "numeric" && typeof score === "number") {
      if (score <= 1) {
        scoreLabel = score.toFixed(2);
        scoreSubLabel = "/ 1.00";
      } else {
        scoreLabel = score.toFixed(1);
        scoreSubLabel = "/ 10";
      }
      barFill = score <= 1 ? score * 100 : Math.min(100, score * 10);
    } else if (scoreType === "categorical") {
      scoreLabel = String(score);
      barFill = 50;
    }
  }

  const hasReasoning = !!eval_.reasoning && eval_.reasoning.length > 0;
  const hasErrorMessage = !!eval_.errorMessage;
  const hasStacktrace =
    !!eval_.errorStacktrace && eval_.errorStacktrace.length > 0;
  const hasListInputs =
    !!eval_.inputs && Object.keys(eval_.inputs).length > 0;
  // Inputs load lazily per-card (see useEvalInputs): the verdict list drops
  // the heavy `Inputs` blob under ClickHouse memory pressure, and even when
  // it's present we don't ship it until a card is expanded. Evals that
  // produced a verdict or errored always recorded inputs, so offer the expand
  // for them and fetch on open.
  const canLazyLoadInputs =
    !!eval_.evaluationId &&
    (status === "pass" || status === "fail" || status === "error");
  const mightHaveInputs = hasListInputs || canLazyLoadInputs;
  const hasRetries = (eval_.retries ?? 0) > 0;
  // The labeled categorical/boolean verdict is sometimes more informative
  // than the numeric score (e.g. score=1 with label="safe").
  const hasLabel = !!eval_.label && eval_.label !== String(eval_.score);

  const meta: string[] = [];
  if (eval_.executionTime !== undefined && eval_.executionTime > 0)
    meta.push(formatDuration(eval_.executionTime));
  if (eval_.evalCost !== undefined && eval_.evalCost > 0)
    meta.push(formatCost(eval_.evalCost));
  if (eval_.evaluatorType) meta.push(eval_.evaluatorType);
  if (hasRetries)
    meta.push(`${eval_.retries} retr${eval_.retries === 1 ? "y" : "ies"}`);

  // For skipped/error rows the reasoning *is* the message ("provider not
  // configured", "request timed out"). Surface it as the primary content.
  // When `details` is missing we fall back to the error message — the
  // worker always populates one or the other.
  const primaryStatusText =
    eval_.reasoning ?? (status === "error" ? eval_.errorMessage : undefined);
  const showStatusMessage = noVerdict && !!primaryStatusText;
  // Whether the dedicated error-message panel should also appear (only when
  // reasoning was already shown above and we still have a separate error
  // message to surface).
  const showErrorPanel =
    status === "error" &&
    hasErrorMessage &&
    eval_.errorMessage !== eval_.reasoning &&
    !!eval_.reasoning;
  // On errored entries, expose the evaluation/evaluator IDs so support can
  // grep logs without having to dig into the raw payload.
  const showErrorIds =
    status === "error" && (!!eval_.evaluationId || !!eval_.evaluatorId);
  // Whether we have anything that warrants the "Show details" expand.
  const hasExpandableDetails =
    mightHaveInputs ||
    hasStacktrace ||
    hasLabel ||
    showErrorPanel ||
    showErrorIds;
  const hasFooterRow =
    !!eval_.spanName || meta.length > 0 || hasExpandableDetails;

  return (
    <Box
      borderRadius="md"
      borderWidth="1px"
      borderColor="border"
      bg="bg.panel"
      overflow="hidden"
    >
      {/* Header strip */}
      <HStack
        paddingX={3}
        paddingY={2}
        gap={2}
        borderBottomWidth={
          hasReasoning || meta.length > 0 || eval_.spanName ? "1px" : "0"
        }
        borderColor="border.muted"
        align="center"
      >
        <HStack
          paddingX={2}
          paddingY={0.5}
          borderRadius="sm"
          bg={tone.bg}
          flexShrink={0}
          gap={1}
        >
          {status === "skipped" && (
            <Icon as={LuCircleSlash} boxSize={2.5} color={tone.fg} />
          )}
          {status === "error" && (
            <Icon as={LuCircleAlert} boxSize={2.5} color={tone.fg} />
          )}
          <Text
            textStyle="2xs"
            fontWeight="bold"
            color={tone.fg}
            letterSpacing="0.06em"
          >
            {tone.label}
          </Text>
        </HStack>
        <Text
          textStyle="sm"
          fontWeight="semibold"
          color="fg"
          flex={1}
          minWidth={0}
          truncate
        >
          {name}
        </Text>
        {eval_.runHistory && eval_.runHistory.length > 1 && (
          <RunHistorySparkline runs={eval_.runHistory} />
        )}
        {!noVerdict && (
          <HStack gap={0.5} align="baseline" flexShrink={0}>
            <Text
              textStyle="lg"
              fontWeight="bold"
              color={tone.color}
              lineHeight={1}
            >
              {scoreLabel}
            </Text>
            {scoreSubLabel && (
              <Text textStyle="2xs" color="fg.subtle">
                {scoreSubLabel}
              </Text>
            )}
          </HStack>
        )}
      </HStack>

      {/* Score bar (numeric, only when the eval actually produced a score) */}
      {!noVerdict && scoreType === "numeric" && (
        <Box
          height="3px"
          bg="bg.subtle"
          position="relative"
          borderBottomWidth={
            hasReasoning || meta.length > 0 || eval_.spanName ? "1px" : "0"
          }
          borderColor="border.muted"
        >
          <Box
            height="100%"
            bg={tone.color}
            width={`${barFill}%`}
            transition="width 0.3s ease"
          />
        </Box>
      )}

      {/* Reasoning / status message */}
      {(hasReasoning || (noVerdict && primaryStatusText)) && (
        <Box
          paddingX={3}
          paddingY={2.5}
          bg={showStatusMessage ? tone.bg : "bg.subtle"}
          borderBottomWidth={hasFooterRow ? "1px" : "0"}
          borderColor="border.muted"
        >
          <HStack align="flex-start" gap={2}>
            <Icon
              as={
                status === "error"
                  ? LuCircleAlert
                  : status === "skipped"
                    ? LuCircleSlash
                    : LuQuote
              }
              boxSize={3}
              color={showStatusMessage ? tone.fg : "fg.subtle"}
              flexShrink={0}
              marginTop={0.5}
            />
            <Text
              textStyle="xs"
              color={showStatusMessage ? tone.fg : "fg.muted"}
              lineHeight="1.6"
              whiteSpace="pre-wrap"
              fontStyle={showStatusMessage ? "normal" : "italic"}
              fontWeight={showStatusMessage ? "medium" : "normal"}
            >
              {showStatusMessage ? (
                primaryStatusText === AZURE_SAFETY_NOT_CONFIGURED_MESSAGE ? (
                  <>
                    Azure Safety provider not configured. Configure it in{" "}
                    <chakra.a
                      href="/settings/model-providers"
                      target="_blank"
                      rel="noopener noreferrer"
                      color="blue.fg"
                      textDecoration="underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      Settings → Model Providers
                    </chakra.a>{" "}
                    to run this evaluator.
                  </>
                ) : (
                  primaryStatusText
                )
              ) : (
                eval_.reasoning
              )}
            </Text>
          </HStack>
        </Box>
      )}

      {/* Footer: span source, meta, details toggle */}
      {hasFooterRow && (
        <EvalCardFooter
          eval_={eval_}
          onSelectSpan={onSelectSpan}
          meta={meta}
          tone={tone}
          mightHaveInputs={mightHaveInputs}
          hasStacktrace={hasStacktrace}
          hasLabel={hasLabel}
          showErrorPanel={showErrorPanel}
          showErrorIds={showErrorIds}
          hasExpandableDetails={hasExpandableDetails}
        />
      )}
    </Box>
  );
}

function EvalCardFooter({
  eval_,
  onSelectSpan,
  meta,
  tone,
  mightHaveInputs,
  hasStacktrace,
  hasLabel,
  showErrorPanel,
  showErrorIds,
  hasExpandableDetails,
}: {
  eval_: EvalEntry;
  onSelectSpan?: (spanId: string) => void;
  meta: string[];
  tone: (typeof STATUS)[keyof typeof STATUS];
  mightHaveInputs: boolean;
  hasStacktrace: boolean;
  hasLabel: boolean;
  showErrorPanel: boolean;
  showErrorIds: boolean;
  hasExpandableDetails: boolean;
}) {
  const [open, setOpen] = useState(false);
  // Fetch inputs only once the panel is open and only if the list query
  // didn't already carry them (the hook short-circuits to the list inputs).
  const { inputEntries, isLoading: inputsLoading } = useEvalInputs({
    eval_,
    enabled: open,
  });

  return (
    <>
      <HStack
        paddingX={3}
        paddingY={1.5}
        gap={3}
        color="fg.subtle"
        flexWrap="wrap"
      >
        {eval_.spanName && (
          <HStack gap={1}>
            <Text textStyle="2xs">from</Text>
            <Flex
              as="button"
              align="center"
              textStyle="2xs"
              color="blue.fg"
              cursor="pointer"
              onClick={() => eval_.spanId && onSelectSpan?.(eval_.spanId)}
              _hover={{ textDecoration: "underline" }}
            >
              {eval_.spanName}
            </Flex>
          </HStack>
        )}
        {meta.map((m, i) => (
          <Text key={i} textStyle="2xs">
            {m}
          </Text>
        ))}
        {hasExpandableDetails && (
          <Button
            size="2xs"
            variant="ghost"
            marginLeft="auto"
            paddingX={1.5}
            height="20px"
            onClick={() => setOpen((v) => !v)}
            color="fg.muted"
            _hover={{ color: "fg", bg: "bg.muted" }}
            gap={0.5}
          >
            <Text textStyle="2xs" fontWeight="medium">
              {open ? "Hide details" : "Show details"}
            </Text>
          </Button>
        )}
      </HStack>
      {open && hasExpandableDetails && (
        <VStack
          align="stretch"
          gap={0}
          borderTopWidth="1px"
          borderColor="border.muted"
          bg="bg.subtle"
        >
          {hasLabel && (
            <DetailRow label="Label">
              <Text
                textStyle="xs"
                color="fg"
                fontWeight="medium"
              >
                {eval_.label}
                {eval_.passed != null && (
                  <Text
                    as="span"
                    textStyle="2xs"
                    color={eval_.passed ? "green.fg" : "red.fg"}
                    marginLeft={2}
                  >
                    ({eval_.passed ? "passed" : "failed"})
                  </Text>
                )}
              </Text>
            </DetailRow>
          )}
          {showErrorPanel && eval_.errorMessage && (
            <DetailRow label="Error">
              <Text
                textStyle="xs"
                color={tone.fg}
                whiteSpace="pre-wrap"
                wordBreak="break-word"
              >
                {eval_.errorMessage}
              </Text>
            </DetailRow>
          )}
          {showErrorIds && (
            <DetailRow label="IDs">
              <VStack align="stretch" gap={1}>
                {eval_.evaluationId && (
                  <HStack align="flex-start" gap={2} minWidth={0}>
                    <Text
                      textStyle="2xs"
                      color="fg.subtle"
                      flexShrink={0}
                      minWidth="80px"
                    >
                      evaluation
                    </Text>
                    <Text
                      textStyle="2xs"
                      color="fg"
                      wordBreak="break-all"
                    >
                      {eval_.evaluationId}
                    </Text>
                  </HStack>
                )}
                {eval_.evaluatorId && (
                  <HStack align="flex-start" gap={2} minWidth={0}>
                    <Text
                      textStyle="2xs"
                      color="fg.subtle"
                      flexShrink={0}
                      minWidth="80px"
                    >
                      evaluator
                    </Text>
                    <Text
                      textStyle="2xs"
                      color="fg"
                      wordBreak="break-all"
                    >
                      {eval_.evaluatorId}
                    </Text>
                  </HStack>
                )}
              </VStack>
            </DetailRow>
          )}
          {hasStacktrace && (
            <DetailRow label="Stacktrace">
              <Box
                as="pre"
                textStyle="2xs"
                color="fg.muted"
                whiteSpace="pre-wrap"
                wordBreak="break-word"
                bg="bg.panel"
                borderRadius="sm"
                paddingX={2}
                paddingY={1.5}
                margin={0}
                maxHeight="240px"
                overflow="auto"
              >
                {eval_.errorStacktrace!.join("\n")}
              </Box>
            </DetailRow>
          )}
          {mightHaveInputs && (
            <DetailRow label="Inputs">
              {inputsLoading ? (
                <HStack gap={2} color="fg.subtle">
                  <Spinner size="xs" />
                  <Text textStyle="2xs">Loading inputs…</Text>
                </HStack>
              ) : inputEntries.length > 0 ? (
                <VStack align="stretch" gap={1}>
                  {inputEntries.map(([key, value]) => (
                    <HStack key={key} align="flex-start" gap={2} minWidth={0}>
                      <Text
                        textStyle="2xs"
                        color="fg.subtle"
                        flexShrink={0}
                        minWidth="80px"
                      >
                        {key}
                      </Text>
                      <Box
                        as="pre"
                        textStyle="2xs"
                        color="fg"
                        whiteSpace="pre-wrap"
                        wordBreak="break-word"
                        margin={0}
                        flex={1}
                        maxHeight="160px"
                        overflow="auto"
                      >
                        {formatInputValue(value)}
                      </Box>
                    </HStack>
                  ))}
                </VStack>
              ) : (
                <Text textStyle="2xs" color="fg.subtle" fontStyle="italic">
                  No inputs recorded
                </Text>
              )}
            </DetailRow>
          )}
        </VStack>
      )}
    </>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <Box
      paddingX={3}
      paddingY={2}
      _notFirst={{ borderTopWidth: "1px", borderColor: "border.muted" }}
    >
      <Text
        textStyle="2xs"
        color="fg.subtle"
        textTransform="uppercase"
        letterSpacing="0.06em"
        fontWeight="600"
        marginBottom={1}
      >
        {label}
      </Text>
      {children}
    </Box>
  );
}
