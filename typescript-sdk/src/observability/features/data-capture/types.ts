/**
 * Data capture modes for controlling automatic capture behavior.
 */
export type DataCaptureMode =
  | "none"   // Capture nothing
  | "input"  // Capture only input data
  | "output" // Capture only output data
  | "all";   // Capture both input and output data

/**
 * Context provided to data capture predicates for making decisions.
 */
export interface DataCaptureContext {
  /** Type of span (e.g., "llm", "chain", "tool", "retriever") */
  spanType: string;

  /** Name of the operation being performed */
  operationName: string;

  /** Any additional attributes set on the span */
  spanAttributes: Record<string, any>;

  /** Environment (development, staging, production) */
  environment?: string;
}

/**
 * Predicate function for dynamic capture decisions.
 *
 * @param context - Context about the span and operation
 * @returns Capture mode to use for this specific operation
 */
export type DataCapturePredicate = (context: DataCaptureContext) => DataCaptureMode;

/**
 * Configuration for what data should be captured in spans.
 *
 * This provides simple control over input/output data capture
 * by LangWatch instrumentations.
 */
export interface DataCaptureConfig {
  /**
   * Controls data capture behavior.
   *
   * @default "all"
   */
  mode?: DataCaptureMode;
}

/**
 * Union type for all supported data capture configuration formats.
 */
export type DataCaptureOptions = DataCaptureMode | DataCaptureConfig | DataCapturePredicate;
