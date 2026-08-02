import { Circle, HStack, Icon, Text } from "@chakra-ui/react";
import { AlertTriangle, GitBranch, Zap } from "lucide-react";
import type React from "react";
import {
  formatCost,
  formatTokens,
  formatWallClock,
} from "../../../../../utils/formatters";
import type { ConversationGroup } from "../../../conversationGroups";

interface SummaryProps {
  group: ConversationGroup;
}

function endTimestamp(group: ConversationGroup): number {
  // Server-grouped session rows carry no turn rows until expansion loads
  // them, so the last turn's duration is a best-effort refinement only.
  const lastTrace = group.traces[group.traces.length - 1];
  return group.latestTimestamp + (lastTrace?.durationMs ?? 0);
}

function pluralise(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}

/**
 * The trace-count line. `traceCount` is the server rollup over the whole
 * session, while the expanded turn list is a capped preview, so once fewer
 * turns are loaded than the session holds the label says which of the two it
 * is showing rather than letting the list read as complete.
 */
export function traceCountLabel(group: ConversationGroup): string {
  const noun = pluralise(group.traceCount, "trace", "traces");
  const loaded = group.traces.length;
  if (loaded > 0 && loaded < group.traceCount) {
    return `${loaded} of ${group.traceCount} ${noun}`;
  }
  return `${group.traceCount} ${noun}`;
}

export const ConversationSummaryLine: React.FC<SummaryProps> = ({ group }) => {
  const endTime = endTimestamp(group);
  return (
    <HStack gap={3} flexWrap="wrap" textStyle="xs" color="fg.subtle">
      <Text>{traceCountLabel(group)}</Text>
      <Separator />
      <Text>{formatWallClock(group.earliestTimestamp, endTime)}</Text>
      {group.primaryModel && (
        <>
          <Separator />
          <Text truncate maxW="16rem" title={group.primaryModel}>
            {group.primaryModel}
          </Text>
        </>
      )}
      {group.totalCost > 0 && (
        <>
          <Separator />
          <Text>{formatCost(group.totalCost)}</Text>
        </>
      )}
      {group.totalTokens > 0 && (
        <>
          <Separator />
          <Text>{formatTokens(group.totalTokens)} tokens</Text>
        </>
      )}
      {group.errorCount > 0 && (
        <>
          <Separator />
          <HStack gap={1}>
            <Icon boxSize="10px" color="red.fg">
              <AlertTriangle />
            </Icon>
            <Text color="red.fg">
              {group.errorCount}{" "}
              {pluralise(group.errorCount, "error", "errors")}
            </Text>
          </HStack>
        </>
      )}
    </HStack>
  );
};

export const ConversationSummaryDetail: React.FC<SummaryProps> = ({
  group,
}) => {
  const endTime = endTimestamp(group);
  return (
    <HStack gap={3} textStyle="xs" color="fg.subtle">
      <Text>{traceCountLabel(group)}</Text>
      <Separator />
      <Text>{formatWallClock(group.earliestTimestamp, endTime)}</Text>
      {group.primaryModel && (
        <>
          <Separator />
          <Text truncate maxW="16rem" title={group.primaryModel}>
            {group.primaryModel}
          </Text>
        </>
      )}
      {group.totalSpans > 0 && (
        <>
          <Separator />
          <HStack gap={1}>
            <Icon boxSize="10px">
              <GitBranch />
            </Icon>
            <Text>{group.totalSpans} spans</Text>
          </HStack>
        </>
      )}
      {group.totalCost > 0 && (
        <>
          <Separator />
          <Text>{formatCost(group.totalCost)}</Text>
        </>
      )}
      {group.totalTokens > 0 && (
        <>
          <Separator />
          <Text>{formatTokens(group.totalTokens)} tokens</Text>
        </>
      )}
      {group.errorCount > 0 && (
        <>
          <Separator />
          <HStack gap={1}>
            <Icon boxSize="10px" color="red.fg">
              <AlertTriangle />
            </Icon>
            <Text color="red.fg">
              {group.errorCount}{" "}
              {pluralise(group.errorCount, "error", "errors")}
            </Text>
          </HStack>
        </>
      )}
      {group.totalEvents > 0 && (
        <>
          <Separator />
          <HStack gap={1}>
            <Icon boxSize="10px" color="orange.fg">
              <Zap />
            </Icon>
            <Text>
              {group.totalEvents}{" "}
              {pluralise(group.totalEvents, "event", "events")}
            </Text>
          </HStack>
        </>
      )}
      {group.totalEvals > 0 && (
        <>
          <Separator />
          <HStack gap={1}>
            <Circle
              size="6px"
              bg={group.evalsFailedCount > 0 ? "red.solid" : "green.solid"}
            />
            <Text>
              {group.evalsPassedCount}/{group.totalEvals} evals
            </Text>
          </HStack>
        </>
      )}
      {group.serviceName && (
        <>
          <Separator />
          <Text>{group.serviceName}</Text>
        </>
      )}
    </HStack>
  );
};

const Separator: React.FC = () => <Text>·</Text>;
