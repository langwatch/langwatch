import asyncio
from typing import List, Sequence

from opentelemetry.sdk.trace.export import SpanExporter, SpanExportResult
from opentelemetry.sdk.trace import ReadableSpan

from langwatch.domain import SpanExporterRule


class AsyncBatchExporter(SpanExporter):
    def __init__(
        self,
        exporter: SpanExporter,
        max_queue_size: int = 1000,
        max_export_batch_size: int = 100,
        export_interval: float = 5.0,
        span_exporter_rules: List[SpanExporterRule] = [],
    ):
        """
        Initialize the async exporter.

        Args:
            exporter: The underlying synchronous exporter.
            max_queue_size: Maximum number of spans to queue.
            max_export_batch_size: Maximum number of spans to export in one batch.
            export_interval: How long to wait (in seconds) if the queue is empty.
        """
        self.exporter = exporter
        self.max_queue_size = max_queue_size
        self.max_export_batch_size = max_export_batch_size
        self.export_interval = export_interval
        self.span_exporter_rules = span_exporter_rules
        self.queue: asyncio.Queue[ReadableSpan] = asyncio.Queue(maxsize=max_queue_size)
        self._shutdown = False

        # Get the current loop and start the async background worker.
        self.loop = asyncio.get_event_loop()
        self._export_task = self.loop.create_task(self._export_worker())

    async def _export_worker(self):
        while not self._shutdown:
            batch: list[ReadableSpan] = []
            try:
                # Wait for a span or timeout after export_interval seconds.
                span = await asyncio.wait_for(self.queue.get(), timeout=self.export_interval)
                batch.append(span)
            except asyncio.TimeoutError:
                # If timed out and there's something in the queue, prepare to export.
                if self.queue.empty():
                    continue
                # Else, proceed to process what's in the queue.
            except Exception as e:
                print(f"Error while waiting for a span: {e}")
                continue

            # Drain the queue up to max_export_batch_size.
            while not self.queue.empty() and len(batch) < self.max_export_batch_size:
                batch.append(self.queue.get_nowait())

            # Offload the synchronous exporter call to a thread so as not block the event loop.
            try:
                await self.loop.run_in_executor(None, self.exporter.export, batch)
            except Exception as e:
                print(f"Error during export: {e}")
            finally:
                # Mark each span in the batch as processed.
                for _ in batch:
                    self.queue.task_done()

    def export(self, spans: Sequence[ReadableSpan]) -> SpanExportResult:
        """
        Called by OpenTelemetry SDK when spans are ready to be exported.
        This implementation enqueues spans asynchronously.

        Args:
            spans: A sequence of spans.

        Returns:
            SpanExportResult.SUCCESS to indicate the spans were enqueued.
        """
        for span in spans:
            skip_span = False
            for rule in self.span_exporter_rules:
                if rule.target == "span_name":
                    if rule.action == "exclude" and rule.rule in span.name:
                        skip_span = True
                        continue
            if skip_span:
                continue

            try:
                self.queue.put_nowait(span)
            except asyncio.QueueFull:
                # If the queue is full, you might opt to drop spans or implement backpressure.
                print("Queue is full. Dropping span.")
        return SpanExportResult.SUCCESS

    def shutdown(self) -> None:
        """
        Gracefully shutdown the exporter:
          - Wait for remaining spans to be processed.
          - Cancel the background worker.
          - Shutdown the underlying exporter.
        """
        async def _do_shutdown():
            self._shutdown = True
            try:
                await self.queue.join()
            except Exception as e:
                print(f"Queue join error: {e}")

            # Cancel the background task and wait for it to cancel.
            self._export_task.cancel()
            try:
                await self._export_task
            except asyncio.CancelledError:
                pass

            # If the underlying exporter has a shutdown, run it in the executor.
            if hasattr(self.exporter, "shutdown"):
                await self.loop.run_in_executor(None, self.exporter.shutdown)

        try:
            self.loop.run_until_complete(_do_shutdown())
        except Exception as e:
            print(f"Shutdown error: {e}")
