/** Export progress, relayed off the tenant's `export_progress` broadcast (main's export router). */
import { defineTrpcContract } from "@langwatch/api/contract";
import { z } from "zod";

export const exportProgressEventSchema = z.object({
  exportId: z.string(),
  type: z.enum(["progress", "done", "error"]),
  exported: z.number().optional(),
  total: z.number().optional(),
  message: z.string().optional(),
});
export type ExportProgressEvent = z.infer<typeof exportProgressEventSchema>;

export const exportProgressInputSchema = z.object({
  projectId: z.string(),
  exportId: z.string(),
});

/** One relay for every export; a scenario run export is watched under `scenarios:view`. */
export const exportTrpc = defineTrpcContract("export")
  .subscription("onExportProgress")
  .withInput(exportProgressInputSchema)
  .withOutput(exportProgressEventSchema)
  .subscription("onScenarioRunExportProgress")
  .withInput(exportProgressInputSchema)
  .withOutput(exportProgressEventSchema)
  .build();
