/**
 * The request type every Instant Eval spend row carries on `gateway_spend`.
 *
 * In a module of its own because the spend page reads it in the browser, and
 * the outcome builder beside it pulls in the spend pipeline's schemas.
 */
export const INSTANT_EVAL_REQUEST_TYPE = "instant_eval";
