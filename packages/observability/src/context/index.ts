import { registerLogContextProvider } from "../logger.ts";
import { getLogContext } from "./logging.ts";

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
} from "./core.ts";
export { getLogContext } from "./logging.ts";
