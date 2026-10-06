/**
 * The key a door resolved, as a handler may read it (E5), and the kinds a route admits (E7).
 * Read off what the door recorded for the request, so no handler reads a credential itself.
 */
import type {
  RestKeyDoorPrincipal,
  RestResolvedOrganizationCredential,
  RestResolvedProjectCredential,
} from "@langwatch/authorization";

import { KeyKindRefusedError } from "../errors.ts";
import {
  keyDoorPrincipalOfRequest,
  organizationCredentialOfRequest,
  projectCredentialOfRequest,
} from "./credential.ts";

/** Every kind of key a key door resolves; an allow-list fails closed when a kind is added. */
export const REST_KEY_KINDS = [
  "api_key",
  "access_token",
  "legacy_project_key",
  "ingestion_key",
  "langy_session_key",
] as const;

export type RestKeyKind = (typeof REST_KEY_KINDS)[number];

/** The doors that resolve a key, and so the only ones a route may ask to be handed it. */
export type RestKeyDoor = "project" | "organization" | "api_key";

/** The doors whose record tells every kind apart, and so the only ones that may admit a list. */
export type RestKeyKindDoor = "project";

/** What a handler is handed beside `actor`: no key id for a token or a legacy key. */
export type RestKeyCredential = Readonly<{
  kind: RestKeyKind;
  apiKeyId: string | null;
  ownerUserId: string | null;
}>;

/** The key kinds a route admits: at least one, none twice. */
export type RestKeyKinds = readonly [RestKeyKind, ...RestKeyKind[]];

const KEY_DOORS: readonly string[] = ["project", "organization", "api_key"];

/** Whether `door` resolves a key a handler may be handed. */
export function isKeyDoor(door: string): door is RestKeyDoor {
  return KEY_DOORS.includes(door);
}

/** The key a project, organization or key-door credential stands for. */
export function keyCredentialOf(
  credential:
    | RestResolvedProjectCredential
    | RestResolvedOrganizationCredential
    | RestKeyDoorPrincipal,
): RestKeyCredential {
  if ("type" in credential) return resolvedKeyOf(credential);

  switch (credential.kind) {
    case "project":
      return { kind: "legacy_project_key", apiKeyId: null, ownerUserId: null };
    case "cliAccessToken":
      return { kind: "access_token", apiKeyId: null, ownerUserId: credential.userId };
    case "apiKey":
      return { kind: "api_key", apiKeyId: credential.apiKeyId, ownerUserId: credential.userId };
  }
}

function resolvedKeyOf(
  credential: RestResolvedProjectCredential | RestResolvedOrganizationCredential,
): RestKeyCredential {
  switch (credential.type) {
    case "legacyProjectKey":
      return { kind: "legacy_project_key", apiKeyId: null, ownerUserId: null };
    case "cliAccessToken":
      return { kind: "access_token", apiKeyId: null, ownerUserId: credential.userId };
    case "apiKey-org":
      return { kind: "api_key", apiKeyId: credential.apiKeyId, ownerUserId: credential.userId };
    case "apiKey":
      return {
        kind: projectKeyKindOf(credential),
        apiKeyId: credential.apiKeyId,
        ownerUserId: credential.userId,
      };
  }
}

function projectKeyKindOf(
  credential: Extract<RestResolvedProjectCredential, { type: "apiKey" }>,
): RestKeyKind {
  if (credential.isLangySessionKey === true) return "langy_session_key";
  if (credential.ingestionTemplateId !== null) return "ingestion_key";

  return "api_key";
}

/** The key the door behind `door` recorded for this request; none recorded is a wiring bug. */
export function keyCredentialOfDoor({
  door,
  request,
}: {
  door: RestKeyDoor;
  request: Request;
}): RestKeyCredential {
  switch (door) {
    case "project":
      return keyCredentialOf(projectCredentialOfRequest(request));
    case "organization":
      return keyCredentialOf(organizationCredentialOfRequest(request));
    case "api_key":
      return keyCredentialOf(keyDoorPrincipalOfRequest(request));
  }
}

/** Refuses a key whose kind the route does not admit, naming the kind and never the key. */
export function assertKeyKind({
  key,
  admitted,
}: {
  key: RestKeyCredential;
  admitted: readonly RestKeyKind[];
}): void {
  if (!admitted.includes(key.kind)) throw new KeyKindRefusedError(key.kind);
}

/** A list of admitted kinds is refused where it is written when empty or repeating one. */
export function keyKindsOf({
  address,
  kinds,
}: {
  address: string;
  kinds: readonly RestKeyKind[];
}): RestKeyKinds {
  const [first, ...rest] = kinds;

  if (!first) throw new Error(`${address} admits no key kind`);

  if (new Set(kinds).size !== kinds.length) {
    throw new Error(`${address} names one key kind twice among the kinds it admits`);
  }

  for (const kind of kinds) {
    if (!(REST_KEY_KINDS as readonly string[]).includes(kind)) {
      throw new Error(`${address} admits "${kind}", which is no key kind`);
    }
  }

  return [first, ...rest];
}
