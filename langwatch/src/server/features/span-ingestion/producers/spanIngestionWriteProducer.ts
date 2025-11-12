import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";

export interface SpanIngestionWriteProducer {
  enqueueSpanIngestionWriteJob(
    tenantId: string,
    span: ReadableSpan,
  ): Promise<void>;
}

export {
  BullMQSpanIngestionWriteProducer,
  spanIngestionWriteProducer,
} from "./bullmqSpanIngestionWriteProducer";
