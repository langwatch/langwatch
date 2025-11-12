import type { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import type { SpanIngestionWriteProducer } from "../../producers/spanIngestionWriteProducer";

export class MockSpanIngestionWriteProducer implements SpanIngestionWriteProducer {
  private calls: Array<{
    tenantId: string;
    span: ReadableSpan;
  }> = [];

  private shouldThrowError = false;
  private errorToThrow: Error | null = null;

  async enqueueSpanIngestionWriteJob(
    tenantId: string,
    span: ReadableSpan,
  ): Promise<void> {
    this.calls.push({ tenantId, span });

    if (this.shouldThrowError) {
      throw this.errorToThrow || new Error("Mock producer error");
    }
  }

  // Test helper methods
  getCalls(): Array<{ tenantId: string; span: ReadableSpan }> {
    return [...this.calls];
  }

  getCallCount(): number {
    return this.calls.length;
  }

  getLastCall(): { tenantId: string; span: ReadableSpan } | undefined {
    return this.calls[this.calls.length - 1];
  }

  reset(): void {
    this.calls = [];
    this.shouldThrowError = false;
    this.errorToThrow = null;
  }

  setShouldThrowError(shouldThrow: boolean, error?: Error): void {
    this.shouldThrowError = shouldThrow;
    this.errorToThrow = error || null;
  }
}
