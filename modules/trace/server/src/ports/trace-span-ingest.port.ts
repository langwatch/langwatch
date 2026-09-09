/**
 * Recording one span through the deployment's ingestion pipeline.
 *
 * Two read-side surfaces WRITE a span: the reserved-metadata amendment
 * (`tracesV2.changeMetadata`, and the REST route beside it) synthesises a
 * `langwatch.metadata_update` span, and the agent test records the request it
 * made. Neither is a fold — both hand the span to the same producer the
 * collector hands one to — so what they need is the command, not the pipeline.
 *
 * A port because the command is the PROCESS's: a deployment with no queue
 * registered has nowhere to send it, and must refuse by name rather than
 * dropping a write it reported as done.
 */
import type { RecordSpanCommandData } from "@langwatch/trace-contract";

export abstract class TraceSpanIngestPort {
  abstract recordSpan(data: RecordSpanCommandData): Promise<void>;
}
