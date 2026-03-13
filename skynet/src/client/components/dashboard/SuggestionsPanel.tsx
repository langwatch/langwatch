import { useState, useCallback } from "react";
import { Box, Text, VStack, HStack, Badge, Button } from "@chakra-ui/react";
import type { DashboardData } from "../../../shared/types.ts";
import { apiPost } from "../../hooks/useApi.ts";

type ActionType = "drain-all-blocked" | "move-to-dlq";

interface Suggestion {
  message: string;
  severity: "info" | "warning" | "critical";
  action?: { label: string; type: ActionType };
}

function deriveSuggestions(data: DashboardData): Suggestion[] {
  const suggestions: Suggestion[] = [];

  const blockedRatio = data.totalGroups > 0 ? data.blockedGroups / data.totalGroups : 0;

  if (blockedRatio > 0.5 && data.blockedGroups > 10) {
    suggestions.push({
      message: `${Math.round(blockedRatio * 100)}% of groups are blocked (${data.blockedGroups.toLocaleString()}). Consider draining or investigating errors.`,
      severity: "critical",
      action: { label: "Drain All Blocked", type: "drain-all-blocked" },
    });
  } else if (blockedRatio > 0.2 && data.blockedGroups > 5) {
    suggestions.push({
      message: `${data.blockedGroups.toLocaleString()} groups are blocked (${Math.round(blockedRatio * 100)}%). Monitor for further increase.`,
      severity: "warning",
      action: { label: "Add to DLQ", type: "move-to-dlq" },
    });
  }

  if (data.completedPerSec === 0 && data.totalPendingJobs > 0) {
    suggestions.push({
      message: `${data.totalPendingJobs.toLocaleString()} jobs pending but throughput is 0/s. Check that workers are running.`,
      severity: "critical",
    });
  }

  if (data.failedPerSec > data.completedPerSec && data.failedPerSec > 0) {
    suggestions.push({
      message: `Failure rate (${data.failedPerSec}/s) exceeds completion rate (${data.completedPerSec}/s).`,
      severity: "warning",
    });
  }

  if (data.throughputHistory.length > 30) {
    const recent = data.throughputHistory[data.throughputHistory.length - 1];
    const older = data.throughputHistory[data.throughputHistory.length - 30];
    if (recent && older && recent.pendingCount !== undefined && older.pendingCount !== undefined) {
      const growth = recent.pendingCount - older.pendingCount;
      if (growth > 1000) {
        suggestions.push({
          message: `Backlog growing: +${growth.toLocaleString()} pending jobs in the last minute.`,
          severity: "warning",
        });
      }
    }
  }

  return suggestions;
}

const SEVERITY_COLORS = {
  info: { bg: "rgba(0, 240, 255, 0.08)", border: "rgba(0, 240, 255, 0.2)", text: "#00f0ff" },
  warning: { bg: "rgba(255, 170, 0, 0.08)", border: "rgba(255, 170, 0, 0.2)", text: "#ffaa00" },
  critical: { bg: "rgba(255, 0, 51, 0.08)", border: "rgba(255, 0, 51, 0.2)", text: "#ff0033" },
} as const;

export function SuggestionsPanel({ data }: { data: DashboardData }) {
  const suggestions = deriveSuggestions(data);
  const [loading, setLoading] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const queueNames = data.queues.map((q) => q.name);

  const handleAction = useCallback(async (type: ActionType) => {
    if (queueNames.length === 0) return;

    const confirmed = window.confirm(
      type === "drain-all-blocked"
        ? `Drain ALL blocked groups across ${queueNames.length} queue(s)? This removes their pending jobs permanently.`
        : `Move ALL blocked groups across ${queueNames.length} queue(s) to DLQ? Jobs are preserved for redrive.`
    );
    if (!confirmed) return;

    setLoading(type);
    setResult(null);
    try {
      const endpoint = type === "drain-all-blocked"
        ? "/api/actions/drain-all-blocked"
        : "/api/actions/move-all-blocked-to-dlq";
      const res = await apiPost(endpoint, { queueNames });
      const totalAffected = (res as { drainedCount?: number; movedCount?: number }).drainedCount
        ?? (res as { movedCount?: number }).movedCount
        ?? 0;
      setResult(`${type === "drain-all-blocked" ? "Drained" : "Moved to DLQ"} ${totalAffected} groups`);
    } catch (err) {
      setResult(`Error: ${err instanceof Error ? err.message : "failed"}`);
    } finally {
      setLoading(null);
    }
  }, [queueNames]);

  if (suggestions.length === 0) return null;

  return (
    <Box
      bg="#0a0e17"
      p={4}
      borderRadius="2px"
      border="1px solid"
      borderColor="rgba(255, 170, 0, 0.2)"
      boxShadow="0 0 8px rgba(255, 170, 0, 0.08)"
      mb={6}
    >
      <Text
        fontSize="xs"
        color="#ffaa00"
        fontWeight="600"
        textTransform="uppercase"
        letterSpacing="0.15em"
        mb={3}
      >
        // Suggestions
      </Text>
      <VStack spacing={2} align="stretch">
        {suggestions.map((s, i) => {
          const colors = SEVERITY_COLORS[s.severity];
          return (
            <HStack
              key={i}
              bg={colors.bg}
              border="1px solid"
              borderColor={colors.border}
              borderRadius="2px"
              px={3}
              py={2}
              spacing={3}
            >
              <Badge
                bg={colors.bg}
                color={colors.text}
                fontSize="9px"
                borderRadius="2px"
                textTransform="uppercase"
                flexShrink={0}
              >
                {s.severity}
              </Badge>
              <Text fontSize="xs" color="#b0c4d8" flex="1">
                {s.message}
              </Text>
              {s.action && (
                <Button
                  size="xs"
                  variant="outline"
                  color={colors.text}
                  borderColor={colors.border}
                  _hover={{ bg: colors.bg }}
                  isLoading={loading === s.action.type}
                  onClick={() => handleAction(s.action!.type)}
                  flexShrink={0}
                >
                  {s.action.label}
                </Button>
              )}
            </HStack>
          );
        })}
        {result && (
          <Text fontSize="xs" color="#4a6a7a" pl={3}>
            {result}
          </Text>
        )}
      </VStack>
    </Box>
  );
}
