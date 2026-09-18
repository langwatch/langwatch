/**
 * Licensing UI family mounted at `/settings/license`. Owns the license details
 * card and seat callout; the server owns the transport (tRPC).
 */

export { licensingApi, type LicensingApiMap } from "./behavior/licensing-api.ts";
export {
  LICENSE_PAGE_PERMISSION,
  LicensingHostApi,
  LicensingHostProvider,
  type LicensingFailureNotice,
  type LicensingSuccessNotice,
} from "./model/licensing-host.ts";
