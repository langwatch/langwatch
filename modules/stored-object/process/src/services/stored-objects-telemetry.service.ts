/**
 * The series the legacy index publishes, through the metrics facade.
 */
import { counter } from "@langwatch/observability/metrics";

/** What the legacy index reports about its own work. */
export interface StoredObjectsTelemetry {
  /** A read reached the storage backend and it failed for anything but a 404. */
  recordReadFailure(): void;
}

export class StoredObjectsTelemetryService implements StoredObjectsTelemetry {
  private readonly readFailures = counter({
    name: "stored_object_read_failures_total",
    description: "Total getById calls where the storage get rejected the read",
  });

  static create(): StoredObjectsTelemetryService {
    return new StoredObjectsTelemetryService();
  }

  private constructor() {}

  recordReadFailure(): void {
    this.readFailures.inc();
  }
}
