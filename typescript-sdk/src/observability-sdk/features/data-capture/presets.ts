import { DataCaptureMode } from "./types";

/**
 * Predefined data capture configurations for common use cases.
 */
export const DataCapturePresets = {
  /**
   * Capture both input and output - useful for development and debugging.
   */
  CAPTURE_ALL: "all" as DataCaptureMode,

  /**
   * Capture nothing - useful for high-security environments.
   */
  CAPTURE_NONE: "none" as DataCaptureMode,

  /**
   * Capture only inputs - useful when you want to see what's being sent.
   */
  INPUT_ONLY: "input" as DataCaptureMode,

  /**
   * Capture only outputs - useful when you want to see responses.
   */
  OUTPUT_ONLY: "output" as DataCaptureMode,
} as const;
