import { z } from "zod";

import { CLI_LOGIN_KEY_NAME_PREFIX } from "./api-key.names.ts";

/** Which credential authenticated a request. Recorded on spans and logs; the token never is. */
export const requestCredentialTypeSchema = z.enum([
  "api_key",
  "cli_token",
  "legacy_project_key",
  "session",
]);
export type RequestCredentialType = z.infer<typeof requestCredentialTypeSchema>;

export const CREDENTIAL_TYPE_SPAN_ATTRIBUTE = "langwatch.auth.credential_type";
export const CREDENTIAL_PROJECT_SPAN_ATTRIBUTE = "langwatch.auth.project_id";

/** A key a CLI login minted is a CLI token; every other key is an API key. */
export function apiKeyCredentialTypeOf(key: { name: string }): RequestCredentialType {
  return key.name.startsWith(CLI_LOGIN_KEY_NAME_PREFIX) ? "cli_token" : "api_key";
}
