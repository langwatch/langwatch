/** The hooks Trace's own contract generates, for the screens other modules render. */

import { type ContractApiMap, createModuleApi, type ModuleApi } from "@langwatch/api/web";
import type { tracesTrpc } from "@langwatch/trace-contract";

type TraceApiMap = ContractApiMap<typeof tracesTrpc>;

export const traceClient: ModuleApi<TraceApiMap> = createModuleApi<TraceApiMap>();
