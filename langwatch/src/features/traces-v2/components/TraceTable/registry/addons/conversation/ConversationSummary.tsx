import { Circle, HStack, Icon, Text } from "@chakra-ui/react";
import { AlertTriangle, GitBranch, Zap } from "lucide-react";
import type React from "react";
import {
  abbreviateModel,
  formatCost,
  formatTokens,
  formatWallClock,
} from "../../../../../utils/formatters";
import type { ConversationGroup } from "../../../conversationGroups";

interface SummaryProps {
  group: ConversationGroup;
}

function endTimestamp(group: ConversationGroup): number {
  const lastTrace = group.traces[group.traces.length - 1]!;
  return group.latestTimestamp + lastTrace.durationMs;
}

function pluralise(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}

export const ConversationSummaryLine: React.FC<SummaryProps> = ({ group }) => {
  const endTime = endTimestamp(group);
  return (
    <HStack
      gap={3}
      flexWrap="wrap"
      textStyle="xs"
      color="fg.subtle"
      fontFamily="mono"
    >
      <Text>{group.traces.length} turns</Text>
      <Separator />
      <Text>{formatWallClock(group.earliestTimestamp, endTime)}</Text>
      {group.primaryModel && (
        <>
          <Separator />
          <Text>{abbreviateModel(group.primaryModel)}</Text>
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
          <Text>{formatTokens(group.totalTokens)} tok</Text>
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
      <Text>{group.traces.length} turns</Text>
      <Separator />
      <Text>{formatWallClock(group.earliestTimestamp, endTime)}</Text>
      {group.primaryModel && (
        <>
          <Separator />
          <Text>{abbreviateModel(group.primaryModel)}</Text>
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
          <Text>{formatTokens(group.totalTokens)} tok</Text>
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
