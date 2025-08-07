import { DataCaptureMode } from "./types";

/**
 * Helper function to create environment-aware capture configurations.
 */
export function createEnvironmentAwareConfig(
  development: DataCaptureMode,
  production: DataCaptureMode,
  environment?: string
): DataCaptureMode {
  const env = environment ?? process.env.NODE_ENV ?? "development";
  return env === "production" ? production : development;
}

/**
 * Validates a data capture mode.
 */
export function validateDataCaptureMode(mode: DataCaptureMode): boolean {
  return ["none", "input", "output", "all"].includes(mode);
}
