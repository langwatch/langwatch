import type { DatasetNormalizePayload } from "@langwatch/dataset-contract";

/**
 * Turning one staged upload into the dataset's chunked content.
 *
 * A seam because the work is all I/O - read the staged object, stream it into
 * chunks, flip the row - and the service that sequences it decides only WHEN
 * a payload is normalized, never HOW.
 */
export abstract class DatasetNormalizePort {
  abstract normalize(payload: DatasetNormalizePayload): Promise<void>;
}
