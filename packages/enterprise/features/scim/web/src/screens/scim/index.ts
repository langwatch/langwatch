/**
 * The SCIM family, as the browser application mounts it.
 *
 * ONE SCREEN, ONE ADDRESS: `/settings/scim`.
 *
 * WHY THIS PACKAGE, AND WHY IT IS NEW. The credentials family's rule: a key
 * belongs to the family that owns its TRANSPORT, and `scimToken.*` is mounted
 * from `@langwatch/enterprise-scim-server`. `packages/enterprise/features/scim`
 * had a contract and a server and no web half at all, so this move creates one
 * rather than parking a provisioning surface in a neighbour's package.
 *
 * WHAT THE OWNING FRONTEND FEATURE HAS TO MOUNT is the tRPC Provider this
 * package's hooks run on and the host port that answers for the organization,
 * the SCIM base URL and the two notices.
 */

import type { ComponentType } from "react";

export type ScimScreenLoader = () => Promise<{ default: ComponentType }>;

export const scimScreens = {
  scim: () => import("./scim.screen"),
} as const satisfies Record<string, ScimScreenLoader>;

export type ScimScreenName = keyof typeof scimScreens;

export { SCIM_PAGE_PERMISSION } from "./scim.screen";
export { scimApi, type ScimApiMap, type ScimTokenRow } from "../../behavior/scim-api";
export {
  ScimHostPort,
  ScimHostProvider,
  type ScimFailureNotice,
  type ScimSuccessNotice,
} from "../../model/scim-host";
