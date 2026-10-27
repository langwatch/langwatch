import {
  LWQL_MAX_RESULT_BYTES,
  LWQL_MAX_RESULT_ROWS,
} from "@langwatch/analytics-contract/langwatch-ql-limits";

import type { LangWatchQLResultLimits } from "../repositories/langwatch-ql-executor.repository.ts";

/** The shipped result bounds, single-sourced with the validator's `LIMIT_TOO_HIGH` cap. */
export const DEFAULT_LWQL_RESULT_LIMITS: LangWatchQLResultLimits = {
  maxRows: LWQL_MAX_RESULT_ROWS,
  maxResultBytes: LWQL_MAX_RESULT_BYTES,
};
