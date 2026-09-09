/**
 * What the browser application does when any call fails on a licence limit or
 * a Lite Member restriction: one reader, one modal, marked handled so no
 * screen reports it twice.
 */
export { reportLicenseFailure } from "./license-error-interceptor.ts";
export {
  isHandledByGlobalLicenseHandler,
  isHandledByLiteMemberHandler,
  markAsHandledByLicenseHandler,
  markAsHandledByLiteMemberHandler,
  type LimitExceededInfo,
  type LiteMemberRestrictionInfo,
} from "../../model/license-error.ts";
