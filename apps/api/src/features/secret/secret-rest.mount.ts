/**
 * Binds the two secret REST declarations to this process's credential door. A
 * write is attributed to the USER the key acts as; a key bound to nobody
 * reaches the handler with no actor and is refused there.
 */
import { createErrorHandler } from "@langwatch/api";
import {
  createRestRuntime,
  type MountableRestApp,
  type RestCaller,
  type RestErrorHandler,
} from "@langwatch/api/rest";
import type { Actor } from "@langwatch/actor";
import type { ResolvedApiKeyCredential } from "@langwatch/api-key-contract";
import type { SecretApi } from "@langwatch/secret-contract";
import { secretRest, secretsAliasRest } from "@langwatch/secret-server";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import type { ApiHandlerManagedCredentialPort } from "../../app-rest/app-rest.process-features.ts";

class SecretCredentialRefusal extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly body: object,
  ) {
    super("secret request refused");
    this.name = "SecretCredentialRefusal";
  }
}

/** A scoped key acts as the person who minted it; a legacy project key as nobody. */
function actorOf(resolved: ResolvedApiKeyCredential): Actor | null {
  if (resolved.type !== "apiKey") return null;

  return resolved.userId
    ? { type: "user", id: resolved.userId }
    : { type: "api_key", id: resolved.apiKeyId };
}

/** `/api/secret` and `/api/secrets`, each with its `/api/v1` twin. */
export function mountSecretRest(options: {
  secrets: () => SecretApi;
  credential: ApiHandlerManagedCredentialPort;
}): readonly MountableRestApp[] {
  const runtime = createRestRuntime({
    identity: {
      authenticate: async ({ request, permission }): Promise<RestCaller> => {
        const credential = await options.credential({ request, permission });
        if (!credential.ok) throw new SecretCredentialRefusal(credential.status, credential.body);

        return {
          actor: actorOf(credential.resolved),
          scope: { tier: "project", id: credential.project.id },
          markUsed: credential.markUsed,
        };
      },
    },
  });

  const mount = { app: options.secrets, credential: "projectKey", onError: secretErrors } as const;

  return [
    runtime.mount(secretRest.router(), mount),
    runtime.mount(secretsAliasRest.router(), mount),
  ];
}

const canonicalErrors = createErrorHandler();

/**
 * The credential refusal keeps the body the door wrote; everything else is the
 * canonical envelope, which already renders every `HandledError` this family
 * raises at its own status.
 */
const secretErrors: RestErrorHandler = (error, context) => {
  if (error instanceof SecretCredentialRefusal) return context.json(error.body, error.status);

  return canonicalErrors(error, context);
};
