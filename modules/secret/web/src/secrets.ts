/**
 * The project Secrets family: one screen at `/settings/secrets`. The owning
 * frontend feature mounts the tRPC Provider these hooks run on and the host
 * port answering for project, grant, notices and switcher.
 */

import type { ComponentType } from "react";

export type SecretScreenLoader = () => Promise<{ default: ComponentType }>;

export const secretScreens = {
  secrets: () => import("./ui/sections/secrets-screen.tsx"),
} as const satisfies Record<string, SecretScreenLoader>;

export type SecretScreenName = keyof typeof secretScreens;

export { SECRET_MANAGE_PERMISSION } from "./ui/sections/secrets-screen.tsx";
export { secretApi } from "./behavior/secret-api.ts";
export {
  SECRET_REFUSAL_CODES,
  describeSecretRefusal,
  readSecretRefusalCode,
  type SecretRefusalCopy,
} from "./model/secret-refusal-copy.ts";
export {
  SecretHostApi,
  SecretHostProvider,
  type SecretFailureNotice,
  type SecretHostScope,
  type SecretSuccessNotice,
} from "./model/secret-host.ts";
