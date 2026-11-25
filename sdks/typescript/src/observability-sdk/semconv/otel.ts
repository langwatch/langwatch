/*
  The few stable OpenTelemetry attribute names this SDK writes itself, kept
  local so the 11 MB semantic-conventions package is not a dependency.
*/

export const ATTR_SERVICE_NAME = "service.name";
export const ATTR_GEN_AI_REQUEST_MODEL = "gen_ai.request.model";
export const ATTR_GEN_AI_RESPONSE_MODEL = "gen_ai.response.model";
