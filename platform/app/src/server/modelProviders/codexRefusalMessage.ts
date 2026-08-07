/**
 * Shared needle for the codex coding-assistant-surfaces refusal message.
 *
 * Every enforcement point that rejects a codex model outside its licensed
 * surfaces (see codexRestrictions.ts) builds its own sentence around this
 * constant instead of hand-copying the wording, so the scenario-run error
 * classifier (scenarios/scenario-infra-error.ts) can recognise the refusal
 * from any of them without going stale the moment one throw site rewords
 * its message.
 *
 * Consumed by: api/routers/modelProviders.utils.ts (prepareLitellmParams,
 * two throw sites), codexGatewayModel.ts, modelDefaults.service.ts
 * (sanitizeConfig, setRoleAtScope, setFeatureAtScope), and
 * modelRestrictedForFeatureError.ts.
 */
export const CODING_ASSISTANT_SURFACES_ONLY_NEEDLE =
  "serves the coding-assistant surfaces only";
