import {
  Box,
  Button,
  Circle,
  HStack,
  Icon,
  Text,
  VStack,
} from "@chakra-ui/react";
import { useState } from "react";
import { LuArrowRight } from "react-icons/lu";
import { Tooltip } from "~/components/ui/tooltip";
import { truncateId } from "../../../utils/formatters";
import { type EvalEntry, isNoVerdict, STATUS } from "./utils";

export function EvalHistoryStack({
  entries,
  onSelectSpan,
}: {
  entries: EvalEntry[];
  onSelectSpan?: (spanId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Box
      borderLeftWidth="2px"
      borderLeftColor="border.muted"
      marginLeft={3}
      paddingLeft={3}
      paddingTop={1}
    >
      <Button
        size="xs"
        variant="ghost"
        onClick={() => setExpanded((v) => !v)}
        gap={1}
        paddingX={1.5}
        height="22px"
        color="fg.muted"
        _hover={{ color: "fg", bg: "bg.muted" }}
      >
        <Text textStyle="2xs" fontWeight="medium">
          {expanded ? "Hide" : "Show"} {entries.length} earlier run
          {entries.length === 1 ? "" : "s"}
        </Text>
      </Button>
      {expanded && (
        <VStack align="stretch" gap={1} paddingTop={1.5}>
          {entries.map((e, i) => (
            <EvalHistoryRow key={i} entry={e} onSelectSpan={onSelectSpan} />
          ))}
        </VStack>
      )}
    </Box>
  );
}

function EvalHistoryRow({
  entry,
  onSelectSpan,
}: {
  entry: EvalEntry;
  onSelectSpan?: (spanId: string) => void;
}) {
  const status = STATUS[entry.status as keyof typeof STATUS] ?? STATUS.warning;
  const noVerdict = isNoVerdict(entry.status);
  const time = entry.timestamp
    ? new Date(entry.timestamp).toLocaleTimeString()
    : null;
  const scoreLabel = noVerdict
    ? null
    : typeof entry.score === "boolean"
      ? entry.score
        ? "true"
        : "false"
      : typeof entry.score === "number"
        ? entry.score.toFixed(2)
        : "—";
  const canJump = !!entry.spanId && !!onSelectSpan;
  return (
    <HStack
      gap={2}
      paddingX={2}
      paddingY={1}
      borderRadius="sm"
      _hover={{ bg: "bg.muted" }}
    >
      <Circle size="6px" bg={status.color} flexShrink={0} />
      <Text
        textStyle="2xs"
        color={status.fg}
        fontWeight="medium"
        flexShrink={0}
      >
        {status.label}
      </Text>
      {scoreLabel !== null && (
        <Text textStyle="xs" fontFamily="mono" color="fg" flexShrink={0}>
          {scoreLabel}
        </Text>
      )}
      {time && (
        <Text
          textStyle="2xs"
          color="fg.subtle"
          fontFamily="mono"
          flexShrink={0}
        >
          {time}
        </Text>
      )}
      {entry.spanId ? (
        <Tooltip
          content={
            entry.spanName ? (
              <VStack align="stretch" gap={0.5} minWidth="180px">
                <HStack justify="space-between" gap={4}>
                  <Text textStyle="2xs" color="fg.muted">
                    name
                  </Text>
                  <Text textStyle="2xs" fontFamily="mono" color="fg">
                    {entry.spanName}
                  </Text>
                </HStack>
                <HStack justify="space-between" gap={4}>
                  <Text textStyle="2xs" color="fg.muted">
                    id
                  </Text>
                  <Text textStyle="2xs" fontFamily="mono" color="fg">
                    {entry.spanId}
                  </Text>
                </HStack>
                {canJump && (
                  <Text textStyle="2xs" color="fg.muted" paddingTop={1}>
                    Click to jump to span
                  </Text>
                )}
              </VStack>
            ) : (
              <Text textStyle="2xs" fontFamily="mono">
                {entry.spanId}
              </Text>
            )
          }
          positioning={{ placement: "top" }}
        >
          <HStack
            as={canJump ? "button" : "div"}
            gap={1.5}
            marginLeft="auto"
            minWidth={0}
            cursor={canJump ? "pointer" : "default"}
            onClick={canJump ? () => onSelectSpan!(entry.spanId!) : undefined}
            color="fg.muted"
            _hover={canJump ? { color: "fg" } : undefined}
            transition="color 0.12s ease"
          >
            {entry.spanName && (
              <Text
                textStyle="2xs"
                fontFamily="mono"
                color="inherit"
                truncate
                maxWidth="160px"
              >
                {entry.spanName}
              </Text>
            )}
            <Text
              textStyle="2xs"
              fontFamily="mono"
              color="fg.subtle"
              flexShrink={0}
            >
              {truncateId(entry.spanId)}
            </Text>
            {canJump && <Icon as={LuArrowRight} boxSize={2.5} flexShrink={0} />}
          </HStack>
        </Tooltip>
      ) : (
        <Box flex={1} />
      )}
    </HStack>
  );
}
