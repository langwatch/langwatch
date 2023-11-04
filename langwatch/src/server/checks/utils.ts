import { captureError } from "../../utils/captureError";
import { TRACE_CHECKS_INDEX, esClient } from "../elasticsearch";
import type { TraceCheck } from "../tracer/types";

export const updateCheckStatusInES = async ({
  trace_id,
  project_id,
  check_type,
  status,
  raw_result,
  result,
  error,
  retries,
}: {
  trace_id: string;
  project_id: string;
  check_type: string;
  status: TraceCheck["status"];
  error?: Error;
  raw_result?: object;
  result?: number;
  retries?: number;
}) => {
  const traceCheck: TraceCheck = {
    id: `check_${trace_id}/${check_type}`,
    trace_id,
    project_id,
    check_type,
    status,
    ...(raw_result && { raw_result }),
    ...(result && { result }),
    ...(error && { error: captureError(error) }),
    ...(retries && { retries }),
    timestamps: {
      ...(status == "in_progress" && { started_at: Date.now() }),
      ...((status == "succeeded" || status == "failed") && {
        finished_at: Date.now(),
      }),
    },
  };

  await esClient.update({
    index: TRACE_CHECKS_INDEX,
    id: traceCheck.id,
    body: {
      doc: traceCheck,
      upsert: {
        ...traceCheck,
        timestamps: {
          ...traceCheck.timestamps,
          inserted_at: Date.now(),
        },
      },
    },
    refresh: true,
  });
};
