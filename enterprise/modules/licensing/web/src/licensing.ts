/**
 * Licensing UI family mounted at `/settings/license`. Owns the license details
 * card and seat callout; the server owns the transport (tRPC).
 */

import type { ComponentType } from "react";

export type LicensingScreenLoader = () => Promise<{ default: ComponentType }>;

export const licensingScreens = {
  license: () => import("./ui/sections/license.screen.tsx"),
} as const satisfies Record<string, LicensingScreenLoader>;

export type LicensingScreenName = keyof typeof licensingScreens;

export { LICENSE_PAGE_PERMISSION } from "./ui/sections/license.screen.tsx";
export { licensingApi, type LicensingApiMap } from "./behavior/licensing-api.ts";
export {
  LicensingHostApi,
  LicensingHostProvider,
  type LicensingFailureNotice,
  type LicensingSuccessNotice,
} from "./model/licensing-host.ts";
