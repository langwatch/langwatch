import { registerLogContextProvider } from "../logger";
import { getLogContext } from "./logging";

// Register at module load so server consumers get context-aware logging without
// importing a separate server logger or depending on initialization order.
registerLogContextProvider(getLogContext);

export {
  createContextFromJobData,
  getCurrentContext,
  getJobContextMetadata,
  getOtelSpanContext,
  type JobContextMetadata,
  type JobDataWithContext,
  type RequestContext,
  runWithContext,
  updateCurrentContext,
} from "./core";
export { getLogContext } from "./logging";
