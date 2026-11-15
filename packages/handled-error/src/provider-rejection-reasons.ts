/**
 * The provider discriminants for "this model does not accept a setting the request carried":
 * OpenAI's `unsupported_parameter` (for example `reasoning.effort` on a model without it) and
 * `unsupported_value` (a `temperature` the model fixes). A mediated call's request is built by the
 * platform, not typed by the customer, so a refusal of one of its settings is the platform's to
 * fix and not a choice of model the customer got wrong (#9442).
 */
export const PROVIDER_UNSUPPORTED_PARAMETER_REASONS: ReadonlySet<string> = new Set([
  "unsupported_parameter",
  "unsupported_value",
]);
