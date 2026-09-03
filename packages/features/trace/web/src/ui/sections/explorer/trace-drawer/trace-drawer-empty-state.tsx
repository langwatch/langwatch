import { Box, Button, Code, HStack, IconButton, Text, VStack } from "@chakra-ui/react";
import { AlertTriangle, ArrowLeft, Check, Copy, Inbox, RotateCw, SearchX, X } from "lucide-react";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { type ErrorExplanation, explainAnyError } from "../../errors";
import { useCopyToClipboard } from "../../../../index";

interface TraceDrawerEmptyStateProps {
  /**
   * Loose shape so we can read the tRPC error envelope (`data.code`,
   * `data.error`) or a plain `Error` without coupling to tRPC
   * client types — whatever `useQuery().error` returns.
   */
  error: unknown;
  traceId?: string | undefined;
  onClose: () => void;
  onRetry?: () => void;
  canGoBack?: boolean;
  onGoBack?: () => void;
}

type ErrorKind = "not-found" | "load-failed" | "no-selection";

function classifyError(error: unknown, traceId: string | undefined): ErrorKind {
  if (!traceId) return "no-selection";
  const data = (
    error as {
      data?: {
        code?: string;
        // `kind` is the deprecated pre-`HandledError` discriminant, read as a
        // fallback so this resolves across the transition.
        error?: { code?: string; kind?: string };
      };
    }
  )?.data;
  const domainCode = data?.error?.code ?? data?.error?.kind;
  if (domainCode === "trace_not_found") return "not-found";
  if (data?.code === "NOT_FOUND") return "not-found";
  return "load-failed";
}

/**
 * The chrome for each kind — icon and tone only.
 *
 * The words used to live here too, and they contradicted the registry: this
 * file told the customer a missing trace had "aged out of retention, or the
 * link points to a different project" while `trace_not_found` says "it may
 * still be arriving. Traces take a few seconds to appear." Both were on screen
 * in different places for the same failure, and the local one won. One code,
 * one set of words — `explainAnyError` supplies them now.
 */
const KIND_CONFIG: Record<
  ErrorKind,
  {
    Icon: typeof SearchX;
    palette: "gray" | "orange" | "blue";
  }
> = {
  "not-found": { Icon: SearchX, palette: "gray" },
  "load-failed": { Icon: AlertTriangle, palette: "orange" },
  "no-selection": { Icon: Inbox, palette: "blue" },
};

/**
 * Headline when the failure carries no copy of its own — or, for
 * `no-selection`, when there is no failure at all and never will be.
 */
const KIND_FALLBACK_TITLE: Record<ErrorKind, string> = {
  "not-found": "Trace not found",
  "load-failed": "Couldn't load this trace",
  "no-selection": "No trace selected",
};

/** The one kind with no error behind it, so the one kind that keeps a string. */
const NO_SELECTION_DESCRIPTION = "Pick a trace from the table to see its details here.";

/**
 * The line under the headline.
 *
 * `no-selection` has no error and never will, so it keeps its local string.
 * Otherwise the registry's words win — except for an unregistered `not-found`,
 * where the generic "we've been notified" would contradict a headline that has
 * already said exactly what happened.
 */
function describeKind(kind: ErrorKind, explanation: ErrorExplanation): string {
  if (kind === "no-selection") return NO_SELECTION_DESCRIPTION;
  if (kind === "not-found" && !explanation.isRegistered) return "";
  return explanation.description;
}

export function TraceDrawerEmptyState({
  error,
  traceId,
  onClose,
  onRetry,
  canGoBack,
  onGoBack,
}: TraceDrawerEmptyStateProps) {
  const kind = classifyError(error, traceId);
  const { Icon, palette } = KIND_CONFIG[kind];
  // `explainAnyError` covers all three cases — a handled code, a message the
  // procedure authored for the user, or nothing at all. Registered copy
  // describes the actual failure so it beats this surface's generic headline;
  // the degraded form does not, since "Trace not found" at least names what
  // the customer was looking at.
  const explanation = explainAnyError(error);
  const title = explanation.isRegistered ? explanation.title : KIND_FALLBACK_TITLE[kind];
  // Emptiness, not identity. A registered code with a title and no `describe`
  // (`not_found`, `dspy_step_not_found`, …) returns a fresh object with an
  // empty description, so the slot is rendered conditionally rather than
  // leaving a padded blank line under the headline.
  const description = describeKind(kind, explanation);
  const { copied, copy } = useCopyToClipboard();

  const handleCopy = () => {
    if (!traceId) return;
    copy(traceId);
  };

  return (
    <VStack
      justify="center"
      align="center"
      height="full"
      gap={5}
      paddingX={8}
      paddingY={10}
      textAlign="center"
      position="relative"
    >
      <IconButton
        aria-label="Close drawer"
        size="xs"
        variant="ghost"
        position="absolute"
        top={3}
        right={3}
        color="fg.subtle"
        onClick={onClose}
      >
        <X size={14} />
      </IconButton>

      <Box
        width="64px"
        height="64px"
        borderRadius="full"
        bg={`${palette}.subtle`}
        color={`${palette}.fg`}
        display="flex"
        alignItems="center"
        justifyContent="center"
      >
        <Icon size={28} />
      </Box>

      <VStack gap={2} maxWidth="360px">
        <Text textStyle="lg" fontWeight="600" color="fg">
          {title}
        </Text>
        {/* The sentence that decides what the customer does next, directly
            under the headline. It used to sit below the buttons at `2xs` /
            `fg.subtle` — quieter than the trace id, and after the decision it
            was supposed to inform. */}
        {description && (
          <Text textStyle="sm" color="fg.muted" lineHeight="1.5">
            {description}
          </Text>
        )}
      </VStack>

      {traceId && (
        <HStack
          gap={1.5}
          paddingX={2}
          paddingY={1}
          borderRadius="md"
          bg="bg.subtle"
          borderWidth="1px"
          borderColor="border"
          maxWidth="full"
        >
          <Text
            textStyle="2xs"
            color="fg.subtle"
            textTransform="uppercase"
            letterSpacing="0.08em"
            fontWeight="600"
          >
            Trace ID
          </Text>
          <Code
            fontSize="xs"
            background="transparent"
            paddingX={0}
            color="fg"
            truncate
            maxWidth="220px"
          >
            {traceId}
          </Code>
          <Tooltip content={copied ? "Copied" : "Copy trace ID"}>
            <IconButton
              aria-label="Copy trace ID"
              size="2xs"
              variant="ghost"
              color={copied ? "green.fg" : "fg.subtle"}
              onClick={handleCopy}
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
            </IconButton>
          </Tooltip>
        </HStack>
      )}

      <HStack gap={2} paddingTop={2}>
        {canGoBack && onGoBack && (
          <Button size="sm" variant="ghost" onClick={onGoBack}>
            <ArrowLeft size={14} />
            <Text>Go back</Text>
          </Button>
        )}
        {onRetry && kind === "load-failed" && (
          <Button size="sm" variant="outline" onClick={onRetry}>
            <RotateCw size={14} />
            <Text>Try again</Text>
          </Button>
        )}
        <Button size="sm" variant="solid" colorPalette="blue" onClick={onClose}>
          Close
        </Button>
      </HStack>
    </VStack>
  );
}
