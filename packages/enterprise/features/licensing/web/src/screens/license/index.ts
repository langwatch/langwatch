/**
 * The licensing family, as the browser application mounts it.
 *
 * ONE SCREEN, ONE ADDRESS: `/settings/license`.
 *
 * WHY THIS PACKAGE. The credentials family's rule, read strictly: a key belongs
 * to the family that owns its TRANSPORT. `license.*` is mounted from
 * `@langwatch/enterprise-licensing-server`, `LicenseStatus` is
 * `@langwatch/enterprise-licensing-contract`'s, and every card the page renders
 * — the details card, the seat callout, the load states — was already in this
 * package before the page arrived.
 *
 * WHAT THE OWNING FRONTEND FEATURE HAS TO MOUNT is the tRPC Provider this
 * package's hooks run on and the host port that answers for the organization,
 * the deployment, the purchase link, the cache drop and the two notices.
 */

import type { ComponentType } from "react";

export type LicensingScreenLoader = () => Promise<{ default: ComponentType }>;

export const licensingScreens = {
  license: () => import("./license.screen"),
} as const satisfies Record<string, LicensingScreenLoader>;

export type LicensingScreenName = keyof typeof licensingScreens;

export { LICENSE_PAGE_PERMISSION } from "./license.screen";
export { licensingApi, type LicensingApiMap } from "../../behavior/licensing-api";
export {
  LicensingHostPort,
  LicensingHostProvider,
  type LicensingFailureNotice,
  type LicensingSuccessNotice,
} from "../../model/licensing-host";
