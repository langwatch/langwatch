import {
  Box,
  Button,
  Code,
  HStack,
  IconButton,
  Text,
  VStack,
} from "@chakra-ui/react";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Copy,
  Inbox,
  RotateCw,
  SearchX,
  X,
} from "lucide-react";
import { useState } from "react";
import { Tooltip } from "~/components/ui/tooltip";

interface TraceDrawerEmptyStateProps {
  /**
   * Loose shape so we can read the tRPC error envelope (`data.code`,
   * `data.domainError`) or a plain `Error` without coupling to tRPC
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

function classifyError(
  error: unknown,
  traceId: string | undefined,
): ErrorKind {
  if (!traceId) return "no-selection";
  const data = (
    error as { data?: { code?: string; domainError?: { kind?: string } } }
  )?.data;
  if (data?.domainError?.kind === "trace_not_found") return "not-found";
  if (data?.code === "NOT_FOUND") return "not-found";
  return "load-failed";
}

const KIND_CONFIG: Record<
  ErrorKind,
  {
    Icon: typeof SearchX;
    title: string;
    description: string;
    palette: "gray" | "orange" | "blue";
  }
> = {
  "not-found": {
    Icon: SearchX,
    title: "Trace not found",
    description:
      "We couldn't find this trace. It may have aged out of retention, been deleted, or the link points to a different project.",
    palette: "gray",
  },
  "load-failed": {
    Icon: AlertTriangle,
    title: "Couldn't load this trace",
    description:
      "Something went wrong fetching trace data. The service may be temporarily unavailable — try again in a moment.",
    palette: "orange",
  },
  "no-selection": {
    Icon: Inbox,
    title: "No trace selected",
    description: "Pick a trace from the table to see its details here.",
    palette: "blue",
  },
};

export function TraceDrawerEmptyState({
  error,
  traceId,
  onClose,
  onRetry,
  canGoBack,
  onGoBack,
}: TraceDrawerEmptyStateProps) {
  const kind = classifyError(error, traceId);
  const { Icon, title, description, palette } = KIND_CONFIG[kind];
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (!traceId) return;
    void navigator.clipboard.writeText(traceId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
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
        <Text textStyle="sm" color="fg.muted" lineHeight="1.5">
          {description}
        </Text>
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
        <Button
          size="sm"
          variant="solid"
          colorPalette="blue"
          onClick={onClose}
        >
          Close
        </Button>
      </HStack>

      {kind === "load-failed" && error instanceof Error && error.message && (
        <Text
          textStyle="2xs"
          color="fg.subtle"
          fontFamily="mono"
          maxWidth="360px"
          truncate
          paddingTop={1}
        >
          {error.message}
        </Text>
      )}
    </VStack>
  );
}
