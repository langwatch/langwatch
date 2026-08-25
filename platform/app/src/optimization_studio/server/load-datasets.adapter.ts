import type { DatasetService } from "@langwatch/dataset-contract";
import type { StudioClientEvent } from "@langwatch/workflow-contract";
import { materializeStudioDatasets } from "@langwatch/workflow-server";

/** App compatibility adapter; process composition supplies DatasetService. */
export const loadDatasets = (
  event: StudioClientEvent,
  projectId: string,
  datasets: DatasetService,
): Promise<StudioClientEvent> =>
  materializeStudioDatasets({ event, projectId, datasets });
