/**
 * Who a request acted as and where it came from, as its access record names them: ids and a
 * key kind only, never a key or a secret.
 * Spec: specs/observability/request-log-client-and-principal.feature
 */
import type { Actor } from "@langwatch/authorization";
import type { Context } from "hono";

import type { RestKeyCredential, RestKeyKind } from "./key-credential.ts";

/** Where the door's answer is left for the request logger. */
export const REQUEST_PRINCIPAL = "requestPrincipal" as const;

export type RequestPrincipal = Readonly<{
  userId?: string;
  apiKeyId?: string;
  apiKeyType?: RestKeyKind;
}>;

/** The user or key an actor names, and the kind of key the door resolved, if any. */
export function requestPrincipalOf({
  actor,
  key,
}: {
  actor: Actor | null | undefined;
  key: RestKeyCredential | null | undefined;
}): RequestPrincipal {
  const userId = actor?.type === "user" ? actor.id : void 0;
  // The key id comes from the credential the door recorded, never from the actor: other doors
  // (SCIM, for one) mint an `api_key` actor whose id is not an API key id.
  const apiKeyId = key?.apiKeyId ?? void 0;

  return {
    ...(userId ? { userId } : {}),
    ...(apiKeyId ? { apiKeyId } : {}),
    ...(key?.kind ? { apiKeyType: key.kind } : {}),
  };
}

/** Leaves the principal for the logger; a principal that cannot be read is left out, not thrown. */
export function recordRequestPrincipal({
  context,
  read,
}: {
  context: Context;
  read: () => RequestPrincipal;
}): void {
  try {
    context.set(REQUEST_PRINCIPAL, read());
  } catch {
    // The access record goes without a principal rather than failing the request.
  }
}

/** The access record's fields, OTel semantic-convention names; an unknown value is omitted. */
export function requestPrincipalLogFields({
  principal,
  clientAddress,
}: {
  principal: RequestPrincipal | undefined;
  clientAddress: string | undefined;
}): Record<string, string> {
  return {
    ...(clientAddress ? { "client.address": clientAddress } : {}),
    ...(principal?.userId ? { "user.id": principal.userId } : {}),
    ...(principal?.apiKeyId ? { "api_key.id": principal.apiKeyId } : {}),
    ...(principal?.apiKeyType ? { "api_key.type": principal.apiKeyType } : {}),
  };
}
