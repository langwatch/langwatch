/**
 * Entry point for Node.js observability setup functionality.
 * Provides setupObservability function and related type definitions.
 */

import "../../../internal/otel-api-guard";
export { setupObservability, ensureSetup } from "./setup";
export type { SetupObservabilityOptions, ObservabilityHandle } from "./types";
export { computeBraidSignature, signBaggage, withSignedBaggage } from "../../braids/sign-baggage";
