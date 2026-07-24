import { useState } from "react";
import {
  Badge,
  Box,
  Button,
  HStack,
  Input,
  Text,
  VStack,
} from "@chakra-ui/react";
import { api } from "~/utils/api";
import { useReplayStatus } from "~/hooks/useReplayStatus";
import { toaster } from "~/components/ui/toaster";

export function SingleAggregateReplay({
  projections,
  onReplayStarted,
}: {
  projections: Array<{ projectionName: string }>;
  onReplayStarted: () => void;
}) {
  const statusQuery = useReplayStatus();
  const isReplayRunning = statusQuery.data?.state === "running";

  const [aggregateId, setAggregateId] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [selectedProjections, setSelectedProjections] = useState<Set<string>>(
    new Set(),
  );
  const [since] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 3);
    return d.toISOString().slice(0, 10);
  });

  const startReplayMutation = api.ops.startReplay.useMutation({
    onSuccess: () => {
      void statusQuery.refetch();
      toaster.create({
        title: "Single aggregate replay started",
        type: "success",
      });
      onReplayStarted();
    },
    onError: (error) => {
      toaster.create({
        title: "Failed to start replay",
        description: error.message,
        type: "error",
      });
    },
  });

  function toggleProjection(name: string) {
    setSelectedProjections((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  }

  return (
    <VStack align="stretch" gap={2}>
      <HStack gap={2}>
        <Box flex={1}>
          <Text textStyle="xs" color="fg.muted" marginBottom={1}>
            Aggregate ID
          </Text>
          <Input
            size="sm"
            placeholder="e.g. trace_abc123"
            value={aggregateId}
            onChange={(e) => setAggregateId(e.target.value)}
            fontFamily="mono"
          />
        </Box>
        <Box flex={1}>
          <Text textStyle="xs" color="fg.muted" marginBottom={1}>
            Tenant ID
          </Text>
          <Input
            size="sm"
            placeholder="e.g. project_xyz"
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
            fontFamily="mono"
          />
        </Box>
      </HStack>
      <Box>
        <Text textStyle="xs" color="fg.muted" marginBottom={1}>
          Projections
        </Text>
        <HStack gap={1} flexWrap="wrap">
          {projections.map((p) => (
            <Badge
              key={p.projectionName}
              size="sm"
              variant={
                selectedProjections.has(p.projectionName) ? "solid" : "outline"
              }
              colorPalette={
                selectedProjections.has(p.projectionName) ? "orange" : "gray"
              }
              cursor="pointer"
              onClick={() => toggleProjection(p.projectionName)}
            >
              {p.projectionName}
            </Badge>
          ))}
        </HStack>
      </Box>
      <HStack gap={2}>
        <Button
          size="sm"
          variant="outline"
          disabled={
            !aggregateId.trim() ||
            !tenantId.trim() ||
            selectedProjections.size === 0 ||
            isReplayRunning
          }
          loading={startReplayMutation.isPending}
          onClick={() => {
            startReplayMutation.mutate({
              projectionNames: [...selectedProjections],
              since,
              tenantIds: [tenantId.trim()],
              aggregateIds: [aggregateId.trim()],
              description: `Single aggregate replay: ${aggregateId.trim()}`,
            });
          }}
        >
          Replay Single
        </Button>
        <Text textStyle="xs" color="fg.muted">
          Replays selected projections for a single tenant (events from last 3
          months)
        </Text>
      </HStack>
    </VStack>
  );
}
