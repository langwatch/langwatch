import { Center, Spinner, VStack } from "@chakra-ui/react";
import { useState } from "react";
import { api } from "~/utils/api";
import { ProcessFleetCard } from "./ProcessFleetCard";
import { ProcessFleetStrip } from "./ProcessFleetStrip";
import { ProcessInstancesCard } from "./ProcessInstancesCard";
import { ProcessRecentActions } from "./ProcessRecentActions";

/** strip → structure → detail, per best_practices/ops-dashboard.md. */
export function ProcessesContent() {
  const fleet = api.ops.listProcessFleet.useQuery(undefined, {
    refetchInterval: 15_000,
  });
  const [selected, setSelected] = useState<string | null>(null);

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
        selected={selected}
        onSelect={(name) => setSelected(name === selected ? null : name)}
      />
      {selected && <ProcessInstancesCard processName={selected} />}
      <ProcessRecentActions />
    </VStack>
  );
}
