import { CodePreview } from "@langwatch/design-system/code-preview";
import { formatScore } from "@langwatch/design-system/metric-value-formatters";
import { Badge, Button, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { parseEvaluationResult } from "@langwatch/evaluator-contract";
import { useId, useState } from "react";

import {
  EVALUATION_STATUS_TONES,
  getStatusLabel,
} from "../../../model/evaluator/evaluation-results.ts";
import { unwrapSingleOutputKey } from "../../../model/format-target-output.ts";

function readResult(result: unknown): unknown {
  if (typeof result !== "string") return result;
  try {
    return JSON.parse(result);
  } catch {
    return result;
  }
}

export function EvaluatorResultCell({ result }: { result: unknown }) {
  const [showJson, setShowJson] = useState(false);
  const jsonId = useId();
  const raw = readResult(result);
  const value = readResult(unwrapSingleOutputKey(raw));
  const parsed = parseEvaluationResult(value);
  const tone =
    parsed.status === "error"
      ? { bg: "orange.subtle", fg: "orange.fg" }
      : EVALUATION_STATUS_TONES[parsed.status];
  const highlighted = parsed.status === "failed" || parsed.status === "error";

  return (
    <VStack
      align="stretch"
      gap={1.5}
      p={2}
      borderRadius="md"
      bg={highlighted ? tone.bg : "transparent"}
      borderLeftWidth="3px"
      borderLeftColor={highlighted ? tone.fg : "transparent"}
      data-evaluation-status={parsed.status}
    >
      <HStack gap={2} flexWrap="wrap">
        <Badge bg={tone.bg} color={tone.fg} size="sm">
          {getStatusLabel(parsed.status)}
        </Badge>
        {parsed.score !== undefined && (
          <Text fontSize="xs" fontWeight="medium" title={String(parsed.score)}>
            Score {formatScore(parsed.score)}
          </Text>
        )}
        <Button
          size="xs"
          variant="ghost"
          height="24px"
          aria-expanded={showJson}
          aria-controls={jsonId}
          onClick={(event) => {
            event.stopPropagation();
            setShowJson(!showJson);
          }}
        >
          JSON
        </Button>
      </HStack>
      {parsed.label && (
        <Text fontSize="xs" wordBreak="break-word">
          {parsed.label}
        </Text>
      )}
      {parsed.details && (
        <Tooltip
          content={parsed.details}
          contentProps={{ maxWidth: "480px" }}
          interactive
          closeOnScroll={false}
        >
          <Text
            fontSize="13px"
            lineClamp={showJson ? void 0 : 2}
            whiteSpace="pre-wrap"
            wordBreak="break-word"
          >
            {parsed.details}
          </Text>
        </Tooltip>
      )}
      {showJson && (
        <VStack id={jsonId} align="stretch" minWidth={0}>
          <CodePreview
            code={JSON.stringify(raw, null, 2) ?? "null"}
            language="json"
            compact
            maxHeight="320px"
          />
        </VStack>
      )}
    </VStack>
  );
}
