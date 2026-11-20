import { Flex, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";

import {
  formatAbsoluteTime,
  formatRelativeTimeAgo,
} from "../../../../../model/display-formatters.ts";
import type { InstantEvalResultEntry } from "../../../../../model/instant-eval-trace-results.ts";

/** A kept Instant Evals result: the question, its verdict, who asked, which judge, and when. */
export function InstantEvalResultRow({
  result,
  spanName,
  onSelectSpan,
}: {
  result: InstantEvalResultEntry;
  /** The span the judged text came from, when the drawer knows its name. */
  spanName?: string;
  onSelectSpan?: (spanId: string) => void;
}) {
  const isJudged = result.status === "judged";

  return (
    <VStack align="stretch" gap={0.5}>
      <HStack justify="space-between" align="flex-start" gap={2}>
        <Text textStyle="xs" fontWeight="medium">
          {result.question}
        </Text>
        <Text
          textStyle="xs"
          fontWeight={isJudged ? "semibold" : "normal"}
          color={isJudged ? "fg" : "fg.muted"}
          flexShrink={0}
        >
          {result.verdict}
        </Text>
      </HStack>
      <HStack gap={1} color="fg.subtle" flexWrap="wrap">
        <Text textStyle="2xs">
          {[result.sourceLabel, result.judgedTextLabel, result.judgeModel].join(" · ")}
        </Text>
        <Tooltip content={`Judged ${formatAbsoluteTime(result.judgedAt)}`}>
          <Text textStyle="2xs">· {formatRelativeTimeAgo(result.judgedAt)}</Text>
        </Tooltip>
        {spanName && result.spanId !== undefined && (
          <>
            <Text textStyle="2xs">· from</Text>
            <Flex
              as="button"
              align="center"
              textStyle="2xs"
              color="blue.fg"
              cursor="pointer"
              onClick={() => result.spanId && onSelectSpan?.(result.spanId)}
              _hover={{ textDecoration: "underline" }}
            >
              {spanName}
            </Flex>
          </>
        )}
      </HStack>
    </VStack>
  );
}
