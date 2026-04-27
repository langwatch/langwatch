import { Button, HStack, Icon, Text, VStack } from "@chakra-ui/react";
import { useState } from "react";
import type { TraceHeader } from "~/server/api/routers/tracesV2.schemas";
import { LuTriangleAlert, LuX } from "react-icons/lu";

interface Alert {
  id: string;
  type: "warning" | "error";
  message: string;
}

function deriveAlerts(trace: TraceHeader): Alert[] {
  const alerts: Alert[] = [];

  // Exceptions are surfaced by the Exceptions accordion section, not here —
  // avoid rendering the same error message in multiple places.

  if (trace.durationMs > 10_000) {
    const multiplier = Math.round(trace.durationMs / 2_000);
    alerts.push({
      id: "slow",
      type: "warning",
      message: `This trace is ${multiplier}x slower than the 24h average`,
    });
  }

  return alerts;
}

interface ContextualAlertsProps {
  trace: TraceHeader;
}

export function ContextualAlerts({ trace }: ContextualAlertsProps) {
  const allAlerts = deriveAlerts(trace);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  const visibleAlerts = allAlerts.filter((a) => !dismissedIds.has(a.id));
  if (visibleAlerts.length === 0) return null;

  const maxShown = 2;
  const shown = visibleAlerts.slice(0, maxShown);
  const overflow = visibleAlerts.length - maxShown;

  const dismiss = (id: string) => {
    setDismissedIds((prev) => new Set(prev).add(id));
  };

  return (
    <VStack align="stretch" gap={1} paddingX={4} paddingY={1}>
      {shown.map((alert) => (
        <HStack
          key={alert.id}
          gap={2}
          paddingX={3}
          paddingY={2}
          borderRadius="md"
          bg={alert.type === "error" ? "red.subtle" : "yellow.subtle"}
        >
          <Icon
            as={LuTriangleAlert}
            boxSize={4}
            color={alert.type === "error" ? "red.fg" : "yellow.fg"}
            flexShrink={0}
          />
          <Text
            textStyle="xs"
            color={alert.type === "error" ? "red.fg" : "yellow.fg"}
            flex={1}
            lineClamp={2}
          >
            {alert.message}
          </Text>
          <Button
            size="xs"
            variant="ghost"
            onClick={() => dismiss(alert.id)}
            aria-label="Dismiss alert"
            padding={0}
            minWidth="auto"
          >
            <Icon as={LuX} boxSize={3} />
          </Button>
        </HStack>
      ))}
      {overflow > 0 && (
        <Text textStyle="xs" color="fg.muted" paddingLeft={3}>
          and {overflow} more
        </Text>
      )}
    </VStack>
  );
}
