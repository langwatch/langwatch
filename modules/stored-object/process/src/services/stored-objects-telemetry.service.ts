/**
 * The series the legacy index publishes, through the metrics facade.
 */
import { counter } from "@langwatch/observability/metrics";

/** What the legacy index reports about its own work. */
export interface StoredObjectsTelemetry {
  /** A read reached the storage backend and it failed for anything but a 404. */
  recordReadFailure(): void;
}

const storedObjectReadFailuresTotal = counter({
  name: "stored_object_read_failures_total",
  description: "Total getById calls where the storage get rejected the read",
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
