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
} from "@langwatch/design-system/primitives";
import { AZURE_SAFETY_NOT_CONFIGURED_MESSAGE } from "@langwatch/evaluation-contract";
import { type ReactNode, useState } from "react";
import { LuCircleAlert, LuCircleSlash, LuQuote } from "react-icons/lu";

import { type EvalCardView, evalCardView } from "./eval-card-view.ts";
import { RunHistorySparkline } from "./run-history-sparkline.tsx";
import { type ResolvedEvalInputs, useEvalInputs } from "./use-eval-inputs.ts";
import { type EvalEntry, formatInputValue, STATUS } from "./utils.ts";

type StatusTone = (typeof STATUS)[keyof typeof STATUS];

export function EvalCard({
  eval_,
  onSelectSpan,
}: {
  eval_: EvalEntry;
  onSelectSpan?: (spanId: string) => void;
}) {
  const tone = STATUS[eval_.status] ?? STATUS.warning;
  const view = evalCardView(eval_);

  return (
    <Box borderRadius="md" borderWidth="1px" borderColor="border" bg="bg.panel" overflow="hidden">
      <EvalCardHeader eval_={eval_} view={view} tone={tone} />
      {view.showScoreBar && (
        <Box
          height="3px"
          bg="bg.subtle"
          position="relative"
          borderBottomWidth={view.hasHeaderRule ? "1px" : "0"}
          borderColor="border.muted"
        >
          <Box
            height="100%"
            bg={tone.color}
            width={`${view.score.barFill}%`}
            transition="width 0.3s ease"
          />
        </Box>
      )}
      {view.showReasoningPanel && <ReasoningPanel eval_={eval_} view={view} tone={tone} />}
      {view.hasFooterRow && (
        <EvalCardFooter eval_={eval_} onSelectSpan={onSelectSpan} view={view} tone={tone} />
      )}
    </Box>
  );
}

function StatusBadge({ status, tone }: { status: EvalEntry["status"]; tone: StatusTone }) {
  return (
    <HStack paddingX={2} paddingY={0.5} borderRadius="sm" bg={tone.bg} flexShrink={0} gap={1}>
      {status === "skipped" && <Icon as={LuCircleSlash} boxSize={2.5} color={tone.fg} />}
      {status === "error" && <Icon as={LuCircleAlert} boxSize={2.5} color={tone.fg} />}
      <Text textStyle="2xs" fontWeight="bold" color={tone.fg} letterSpacing="0.06em">
        {tone.label}
      </Text>
    </HStack>
  );
}

function EvalCardHeader({
  eval_,
  view,
  tone,
}: {
  eval_: EvalEntry;
  view: EvalCardView;
  tone: StatusTone;
}) {
  const runHistory = eval_.runHistory ?? [];
  return (
    <HStack
      paddingX={3}
      paddingY={2}
      gap={2}
      borderBottomWidth={view.hasHeaderRule ? "1px" : "0"}
      borderColor="border.muted"
      align="center"
    >
      {!view.categoryOnly && <StatusBadge status={eval_.status} tone={tone} />}
      {view.hasLabel && eval_.label && <CategoryChip label={eval_.label} />}
      <Text textStyle="sm" fontWeight="semibold" color="fg" flex={1} minWidth={0} truncate>
        {eval_.name}
      </Text>
      {runHistory.length > 1 && <RunHistorySparkline runs={runHistory} />}
      {view.score.label !== "" && (
        <HStack gap={0.5} align="baseline" flexShrink={0}>
          <Text textStyle="lg" fontWeight="bold" color={tone.color} lineHeight={1}>
            {view.score.label}
          </Text>
          {view.score.subLabel && (
            <Text textStyle="2xs" color="fg.subtle">
              {view.score.subLabel}
            </Text>
          )}
        </HStack>
      )}
    </HStack>
  );
}

function statusIconOf(status: EvalEntry["status"]) {
  if (status === "error") return LuCircleAlert;
  return status === "skipped" ? LuCircleSlash : LuQuote;
}

/** The evaluator's reasoning, or for a run with no verdict the message saying why. */
function ReasoningPanel({
  eval_,
  view,
  tone,
}: {
  eval_: EvalEntry;
  view: EvalCardView;
  tone: StatusTone;
}) {
  const asStatus = view.showStatusMessage;
  return (
    <Box
      paddingX={3}
      paddingY={2.5}
      bg={asStatus ? tone.bg : "bg.subtle"}
      borderBottomWidth={view.hasFooterRow ? "1px" : "0"}
      borderColor="border.muted"
    >
      <HStack align="flex-start" gap={2}>
        <Icon
          as={statusIconOf(eval_.status)}
          boxSize={3}
          color={asStatus ? tone.fg : "fg.subtle"}
          flexShrink={0}
          marginTop={0.5}
        />
        <Text
          textStyle="xs"
          color={asStatus ? tone.fg : "fg.muted"}
          lineHeight="1.6"
          whiteSpace="pre-wrap"
          fontStyle={asStatus ? "normal" : "italic"}
          fontWeight={asStatus ? "medium" : "normal"}
        >
          {asStatus ? <StatusMessage text={view.primaryStatusText} /> : eval_.reasoning}
        </Text>
      </HStack>
    </Box>
  );
}

/**
 * The evaluator's own word for the verdict. Blue rather than a verdict tone:
 * a category is not a pass or a fail, and colouring it like one would put a
 * judgement on it that the evaluator never made.
 */
function CategoryChip({ label }: { label: string }) {
  return (
    <Text
      textStyle="2xs"
      fontWeight="bold"
      color="blue.fg"
      bg="blue.subtle"
      paddingX={2}
      paddingY={0.5}
      borderRadius="sm"
      flexShrink={0}
      maxWidth="180px"
      truncate
      title={label}
    >
      {label}
    </Text>
  );
}

function EvalCardFooter({
  eval_,
  onSelectSpan,
  view,
  tone,
}: {
  eval_: EvalEntry;
  onSelectSpan?: (spanId: string) => void;
  view: EvalCardView;
  tone: StatusTone;
}) {
  const [open, setOpen] = useState(false);
  // Fetch inputs only once the panel is open and only if the list query
  // didn't already carry them (the hook short-circuits to the list inputs).
  const inputs = useEvalInputs({ eval_, enabled: open });

  return (
    <>
      <HStack paddingX={3} paddingY={1.5} gap={3} color="fg.subtle" flexWrap="wrap">
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
        {view.meta.map((m, i) => (
          <Text key={i} textStyle="2xs">
            {m}
          </Text>
        ))}
        {view.hasExpandableDetails && (
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
      {open && view.hasExpandableDetails && (
        <EvalCardDetails eval_={eval_} view={view} tone={tone} inputs={inputs} />
      )}
    </>
  );
}

/** The expanded details: label, error, ids, stacktrace and inputs, each when there is one. */
function EvalCardDetails({
  eval_,
  view,
  tone,
  inputs,
}: {
  eval_: EvalEntry;
  view: EvalCardView;
  tone: StatusTone;
  inputs: ResolvedEvalInputs;
}) {
  return (
    <VStack align="stretch" gap={0} borderTopWidth="1px" borderColor="border.muted" bg="bg.subtle">
      {view.showLabelDetailRow && (
        <DetailRow label="Label">
          <Text textStyle="xs" color="fg" fontWeight="medium">
            {eval_.label}
            {eval_.passed != null && <PassedNote passed={eval_.passed} />}
          </Text>
        </DetailRow>
      )}
      {view.showErrorPanel && (
        <DetailRow label="Error">
          <Text textStyle="xs" color={tone.fg} whiteSpace="pre-wrap" wordBreak="break-word">
            {eval_.errorMessage}
          </Text>
        </DetailRow>
      )}
      {view.showErrorIds && (
        <DetailRow label="IDs">
          <VStack align="stretch" gap={1}>
            <IdLine name="evaluation" id={eval_.evaluationId} />
            <IdLine name="evaluator" id={eval_.evaluatorId} />
          </VStack>
        </DetailRow>
      )}
      {view.hasStacktrace && (
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
            {eval_.errorStacktrace?.join("\n")}
          </Box>
        </DetailRow>
      )}
      {view.mightHaveInputs && <InputsDetail inputs={inputs} />}
    </VStack>
  );
}

function PassedNote({ passed }: { passed: boolean }) {
  return (
    <Text as="span" textStyle="2xs" color={passed ? "green.fg" : "red.fg"} marginLeft={2}>
      ({passed ? "passed" : "failed"})
    </Text>
  );
}

function IdLine({ name, id }: { name: string; id: string | undefined }) {
  if (!id) return null;
  return (
    <HStack align="flex-start" gap={2} minWidth={0}>
      <Text textStyle="2xs" color="fg.subtle" flexShrink={0} minWidth="80px">
        {name}
      </Text>
      <Text textStyle="2xs" color="fg" wordBreak="break-all">
        {id}
      </Text>
    </HStack>
  );
}

function InputsDetail({ inputs }: { inputs: ResolvedEvalInputs }) {
  const { inputEntries, isLoading } = inputs;
  return (
    <DetailRow label="Inputs">
      {isLoading && (
        <HStack gap={2} color="fg.subtle">
          <Spinner size="xs" />
          <Text textStyle="2xs">Loading inputs…</Text>
        </HStack>
      )}
      {!isLoading && inputEntries.length > 0 && (
        <VStack align="stretch" gap={1}>
          {inputEntries.map(([key, value]) => (
            <HStack key={key} align="flex-start" gap={2} minWidth={0}>
              <Text textStyle="2xs" color="fg.subtle" flexShrink={0} minWidth="80px">
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
      )}
      {!isLoading && inputEntries.length === 0 && (
        <Text textStyle="2xs" color="fg.subtle" fontStyle="italic">
          No inputs recorded
        </Text>
      )}
    </DetailRow>
  );
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
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

/**
 * The status line for a verdict-less evaluation. The unconfigured-Azure case
 * gets a link to the settings page that fixes it; everything else prints as-is.
 */
function StatusMessage({ text }: { text: string | undefined }) {
  if (text !== AZURE_SAFETY_NOT_CONFIGURED_MESSAGE) return <>{text}</>;

  return (
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
  );
}
