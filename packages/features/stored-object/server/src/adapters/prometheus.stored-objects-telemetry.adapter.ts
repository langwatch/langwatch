/**
 * The five series the content-addressed store publishes, on Prometheus.
 *
 * The names are the ones the platform application registered, unchanged: a
 * dashboard or alert reading `stored_object_write_failures_total` keeps
 * reading the same counter after the store moved processes, which is the whole
 * point of moving the definitions with the code that increments them.
 */
import { Counter, Histogram, register } from "prom-client";
import { StoredObjectsTelemetryPort } from "../ports/stored-objects-telemetry.port";

// Counter: every storeFromBytes call, whatever it went on to do.
register.removeSingleMetric("stored_object_extract_total");
const storedObjectExtractTotal = new Counter({
  name: "stored_object_extract_total",
  help: "Total storeFromBytes calls",
  labelNames: ["purpose"] as const,
});

// Counter: deduplication hits (content already present for this project)
register.removeSingleMetric("stored_object_dedup_hit_total");
const storedObjectDedupHitTotal = new Counter({
  name: "stored_object_dedup_hit_total",
  help: "Total storeFromBytes calls where content was already present (dedup hit)",
  labelNames: ["purpose"] as const,
});

// Counter: PUT failures (storage backend rejected the write)
register.removeSingleMetric("stored_object_write_failures_total");
const storedObjectWriteFailuresTotal = new Counter({
  name: "stored_object_write_failures_total",
  help: "Total storeFromBytes calls where the storage put rejected the write",
  labelNames: ["purpose"] as const,
});

// Counter: GET failures (storage backend rejected the read)
register.removeSingleMetric("stored_object_read_failures_total");
const storedObjectReadFailuresTotal = new Counter({
  name: "stored_object_read_failures_total",
  help: "Total getById calls where the storage get rejected the read",
});

// Histogram: payload size observed on each storeFromBytes call
register.removeSingleMetric("stored_object_size_bytes");
const storedObjectSizeBytesHistogram = new Histogram({
  name: "stored_object_size_bytes",
  help: "Size of stored object payloads in bytes",
  labelNames: ["purpose"] as const,
  buckets: [
    128, // 0.125 KB
    1024, // 1 KB
    4096, // 4 KB
    16384, // 16 KB
    65536, // 64 KB
    262144, // 256 KB
    1048576, // 1 MB
    4194304, // 4 MB
    16777216, // 16 MB
  ],
});

export class PrometheusStoredObjectsTelemetry extends StoredObjectsTelemetryPort {
  static create(): PrometheusStoredObjectsTelemetry {
    return new PrometheusStoredObjectsTelemetry();
  }

  recordExtract(purpose: string): void {
    storedObjectExtractTotal.labels(purpose).inc();
  }

  recordDedupHit(purpose: string): void {
    storedObjectDedupHitTotal.labels(purpose).inc();
  }

  recordWriteFailure(purpose: string): void {
    storedObjectWriteFailuresTotal.labels(purpose).inc();
  }

  recordReadFailure(): void {
    storedObjectReadFailuresTotal.inc();
  }

  observeSizeBytes(purpose: string, bytes: number): void {
    storedObjectSizeBytesHistogram.labels(purpose).observe(bytes);
  }
}
