import { ListPageSkeleton } from "@langwatch/design-system/list-page";
import { VStack } from "@langwatch/design-system/primitives";
import { HandledErrorAlert } from "@langwatch/error-views";
import { nowInstant } from "@langwatch/time";

import { api } from "../../../../behavior/ops-api.ts";
import { readOverlayParts, useOpsOverlay } from "../../../../behavior/ops-overlays.ts";
import { ProcessFleetStrip } from "../blocks/process-fleet-strip.tsx";
import { ProcessRecentActions as ProcessRecentActionsView } from "../blocks/process-recent-actions.tsx";
import { ProcessFleetCard } from "../elements/process-fleet-card.tsx";
import { ProcessInstanceDrawer } from "./process-instance-drawer.tsx";
import { ProcessInstancesDrawer } from "./process-instances-drawer.tsx";

/** Strip→structure→detail. Both drawers addressed here (each own query key; still
 * shareable). */
export function ProcessesContent() {
  const instances = useOpsOverlay("processes");
  const instance = useOpsOverlay("processInstance");
  const instanceParts = readOverlayParts(instance.value, 3);
  const fleet = api.ops.listProcessFleet.useQuery(undefined, {});

  if (fleet.isPending) {
    return <ListPageSkeleton label="Loading processes" />;
  }

  if (fleet.isError && !fleet.data) {
    return <HandledErrorAlert error={fleet.error} fallbackTitle="The processes could not load" />;
  }

  const rows = fleet.data ?? [];

  return (
    <VStack align="stretch" gap={4}>
      {fleet.isError && (
        <HandledErrorAlert
          error={fleet.error}
          fallbackTitle="Processes could not refresh; showing the last snapshot"
        />
      )}
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

export function ProcessRecentActions() {
  const query = api.ops.listProcessActions.useQuery({ limit: 20 }, {});

  return (
    <ProcessRecentActionsView
      rows={query.data ?? []}
      now={query.dataUpdatedAt || nowInstant().epochMilliseconds}
    />
  );
}
