import { Center, Spinner, VStack } from "@chakra-ui/react";
import { api } from "../../../../behavior/ops-api.ts";
import { ProcessFleetStrip } from "../blocks/process-fleet-strip.tsx";
import { ProcessFleetCard } from "../elements/process-fleet-card.tsx";
import { ProcessRecentActions } from "./process-recent-actions-panel.tsx";
import { ProcessInstanceDrawer } from "./process-instance-drawer.tsx";
import { ProcessInstancesDrawer } from "./process-instances-drawer.tsx";
import { readOverlayParts, useOpsOverlay } from "../../../../behavior/ops-overlays.ts";

/**
 * strip → structure → detail, per best_practices/ops-dashboard.md.
 *
 * BOTH DRAWERS ARE ADDRESSED HERE. `platform/app` registered them by name and
 * mounted them from the application shell; a feature-web package may not carry
 * that registry, so each keeps its own query key on this page — `?processes=`
 * for the instance list (the literal `all` for the every-process view) and
 * `?processInstance=<process>|<tenant>|<key>` for one instance's detail. Both
 * addresses are still shareable, which is the only property the registry ever
 * gave them.
 */
export function ProcessesContent() {
  const instances = useOpsOverlay("processes");
  const instance = useOpsOverlay("processInstance");
  const instanceParts = readOverlayParts(instance.value, 3);
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
        onSelect={(name) => instances.open(name)}
        onOpenAll={() => instances.open(ALL_PROCESSES)}
      />
      <ProcessRecentActions />
      {instances.value !== null && (
        <ProcessInstancesDrawer
          {...(instances.value === ALL_PROCESSES ? {} : { processName: instances.value })}
          onClose={instances.close}
          onOpenInstance={(row) =>
            instance.open([row.processName, row.projectId, row.processKey].join("|"))
          }
        />
      )}
      {instanceParts && (
        <ProcessInstanceDrawer
          processName={instanceParts[0]}
          projectId={instanceParts[1]}
          processKey={instanceParts[2]}
          onClose={instance.close}
        />
      )}
    </VStack>
  );
}

/** The address the every-process view carries, so the key is never empty. */
const ALL_PROCESSES = "all";
