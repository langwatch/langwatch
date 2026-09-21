import { Center, Spinner, VStack } from "@chakra-ui/react";
import { useDrawer } from "~/hooks/useDrawer";
import { api } from "~/utils/api";
import { ProcessFleetCard } from "./ProcessFleetCard";
import { ProcessFleetStrip } from "./ProcessFleetStrip";
import { ProcessRecentActions } from "./ProcessRecentActions";

/** strip → structure → detail, per best_practices/ops-dashboard.md. */
export function ProcessesContent() {
  const { openDrawer } = useDrawer();
  const fleet = api.ops.listProcessFleet.useQuery(undefined, {
    refetchInterval: 15_000,
  });

  if (fleet.isPending) {
    return (
      <Center paddingY={20}>
        <Spinner size="lg" />
      </Center>
    );
  }

  const rows = fleet.data ?? [];

  return (
    <VStack align="stretch" gap={4}>
      <ProcessFleetStrip rows={rows} />
      <ProcessFleetCard
        rows={rows}
        onSelect={(name) =>
          openDrawer("opsProcessInstances", { processName: name })
        }
        onOpenAll={() => openDrawer("opsProcessInstances", {})}
      />
      <ProcessRecentActions />
    </VStack>
  );
}
