/**
 * The Data Privacy family, as the browser application mounts it. One
 * screen, one address (`/settings/data-privacy`), exposed as a LOADER so
 * the rule drawer and audience picker stay out of the app's own chunk.
 */

export {
  privacyRuleAddress,
  privacyRuleForAddress,
  PRIVACY_RULE_NEW_VALUE,
  PRIVACY_RULE_QUERY_KEY,
  PRIVACY_SCOPE_QUERY_KEY,
} from "./model/data-privacy-address.ts";
export { dataPrivacyApi } from "./behavior/data-privacy-api.ts";
export {
  DataPrivacyHostApi,
  DataPrivacyHostProvider,
  type PrivacyFailureNotice,
  type PrivacyHostScope,
  type PrivacyRouteReading,
  type PrivacySuccessNotice,
} from "./model/data-privacy-host.ts";
