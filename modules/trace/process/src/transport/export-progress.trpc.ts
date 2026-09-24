/** The server half of `export.*`: every export's progress, relayed by exportId. */
import { defineTrpcRouter } from "@langwatch/api/trpc";
import { exportTrpc, TraceApi } from "@langwatch/trace-contract";

export const exportProgressTrpcTransport = defineTrpcRouter(TraceApi, exportTrpc)
  .procedure("onExportProgress")
  .withPermission("traces:view")
  .handle(({ app, input, signal }) =>
    app.streamExportProgress({ projectId: input.projectId, exportId: input.exportId, signal }),
  )

  .procedure("onScenarioRunExportProgress")
  .withPermission("scenarios:view")
  .handle(({ app, input, signal }) =>
    app.streamExportProgress({ projectId: input.projectId, exportId: input.exportId, signal }),
  )
  .build();
