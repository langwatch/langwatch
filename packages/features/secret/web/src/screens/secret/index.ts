/**
 * The project Secrets family, as the browser application mounts it.
 *
 * ONE SCREEN, ONE ADDRESS: `/settings/secrets`.
 *
 * WHY THIS IS ITS OWN PACKAGE and not a screen inside `@langwatch/api-key-web`,
 * which moved in the same change: the data-governance family's rule is that a
 * key belongs to the family that owns its transport, and `secrets.*` is mounted
 * from `@langwatch/secret-server`. The RBAC family's exception — the roles pages
 * went to `@langwatch/authz-web` even though `role.*` is the role feature's —
 * turned on every TYPE on those pages coming from authz. Nothing on this page
 * comes from the API key contract: the row, the four refusal codes and the
 * fifty-per-project ceiling are all `@langwatch/secret-contract`'s. So the
 * exception does not apply and the rule does.
 *
 * WHAT THE OWNING FRONTEND FEATURE HAS TO MOUNT is the tRPC Provider this
 * package's hooks run on and the host port that answers for the project, the one
 * grant, the two notices and the application's project switcher.
 */

import type { ComponentType } from "react";

export type SecretScreenLoader = () => Promise<{ default: ComponentType }>;

export const secretScreens = {
  secrets: () => import("./secrets.screen"),
} as const satisfies Record<string, SecretScreenLoader>;

export type SecretScreenName = keyof typeof secretScreens;

export { SECRET_MANAGE_PERMISSION } from "./secrets.screen";
export { secretApi } from "../../behavior/secret-api";
export {
  SECRET_REFUSAL_CODES,
  describeSecretRefusal,
  readSecretRefusalCode,
  type SecretRefusalCopy,
} from "../../model/secret-refusal-copy";
export {
  SecretHostPort,
  SecretHostProvider,
  type SecretFailureNotice,
  type SecretHostScope,
  type SecretSuccessNotice,
} from "../../model/secret-host";
