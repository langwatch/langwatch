/**
 * The series the legacy index publishes, on Prometheus.
 */
import { Counter, register } from "prom-client";

import { type StoredObjectsTelemetry } from "../app/stored-object.members.ts";

// Counter: GET failures (storage backend rejected the read)
register.removeSingleMetric("stored_object_read_failures_total");
const storedObjectReadFailuresTotal = new Counter({
  name: "stored_object_read_failures_total",
  help: "Total getById calls where the storage get rejected the read",
});

export class StoredObjectsTelemetryService implements StoredObjectsTelemetry {
  static create(): StoredObjectsTelemetryService {
    return new StoredObjectsTelemetryService();
  }

  private constructor() {}

  recordReadFailure(): void {
    storedObjectReadFailuresTotal.inc();
  }
}
