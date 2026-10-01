/**
 * The project Secrets family: one screen at `/settings/secrets`. The owning
 * frontend feature mounts the tRPC Provider these hooks run on and the host
 * port answering for project, grant, notices and switcher.
 */

export { secretApi } from "./behavior/secret-api.ts";
export {
  SECRET_REFUSAL_CODES,
  describeSecretRefusal,
  readSecretRefusalCode,
  type SecretRefusalCopy,
} from "./model/secret-refusal-copy.ts";
export {
  SECRET_MANAGE_PERMISSION,
  SecretHostApi,
  SecretHostProvider,
  type SecretFailureNotice,
  type SecretHostScope,
  type SecretSuccessNotice,
} from "./model/secret-host.ts";
