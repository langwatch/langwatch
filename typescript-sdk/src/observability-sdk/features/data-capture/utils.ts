import { type DataCaptureMode } from "./types";

/**
 * Validates a data capture mode.
 */
export function validateDataCaptureMode(mode: DataCaptureMode): boolean {
  return ["none", "input", "output", "all"].includes(mode);
}
