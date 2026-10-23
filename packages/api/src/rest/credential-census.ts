/**
 * What a door admitted, as the credential census counts it. A door that resolved through the key
 * directory already noted the credential; this names the rest from what the door recorded.
 * Spec: modules/auth/specs/request-credential-census.feature
 */
import type { RestResolvedProjectCredential } from "@langwatch/authorization";
import type { RequestCredential } from "@langwatch/observability/credential-census";

import type { RestCaller } from "../hosting/api-door.ts";
import { recordedKeyCredentialOf } from "./credential.ts";
import type { RestDoorCredential } from "./declaration.ts";

/** The credential a door admitted for this request, or none for a door the census does not name. */
export function doorCredentialOf({
  credential,
  caller,
  request,
}: {
  credential: RestDoorCredential;
  caller: RestCaller;
  request: Request;
}): RequestCredential | undefined {
  if (credential === "project" || credential === "organization" || credential === "api_key") {
    return recordedCredentialOf({ door: credential, request }) ?? actorCredentialOf(caller);
  }
  if (credential === "browser") return { credentialType: "session", ...scopeIdsOf(caller) };
  if (credential === "cli_token") return { credentialType: "cli_token", ...scopeIdsOf(caller) };
  if (
    credential === "internal_secret" ||
    credential === "instance_admin" ||
    credential === "licence_token"
  ) {
    return { credentialType: "system", ...scopeIdsOf(caller) };
  }
  if (credential === "otlp_ingest" || credential === "session_key") {
    return (
      actorCredentialOf(caller) ?? { credentialType: "legacy_project_key", ...scopeIdsOf(caller) }
    );
  }

  return undefined;
}

/** The project door's credential: a WebSocket upgrade reads it straight off its door. */
export function projectCredentialOf(credential: RestResolvedProjectCredential): RequestCredential {
  const ids = {
    projectId: credential.project.id,
    organizationId: credential.project.organizationId,
  };
  if (credential.type === "legacyProjectKey")
    return { credentialType: "legacy_project_key", ...ids };
  if (credential.type === "cliAccessToken") return { credentialType: "cli_token", ...ids };

  return { credentialType: "api_key", apiKeyId: credential.apiKeyId, ...ids };
}

function recordedCredentialOf({
  door,
  request,
}: {
  door: "project" | "organization" | "api_key";
  request: Request;
}): RequestCredential | undefined {
  const recorded = recordedKeyCredentialOf({ door, request });
  if (!recorded) return undefined;
  if ("type" in recorded) {
    if (recorded.type === "apiKey-org") {
      return {
        credentialType: "api_key",
        apiKeyId: recorded.apiKeyId,
        organizationId: recorded.organizationId,
      };
    }

    return projectCredentialOf(recorded);
  }
  if (recorded.kind === "project") {
    return { credentialType: "legacy_project_key", projectId: recorded.projectId };
  }
  if (recorded.kind === "cliAccessToken") {
    return {
      credentialType: "cli_token",
      projectId: recorded.projectId,
      organizationId: recorded.organizationId,
    };
  }

  return {
    credentialType: "api_key",
    apiKeyId: recorded.apiKeyId,
    organizationId: recorded.organizationId,
    ...(recorded.resolvedProject ? { projectId: recorded.resolvedProject.id } : {}),
  };
}

function actorCredentialOf(caller: RestCaller): RequestCredential | undefined {
  return caller.actor?.type === "api_key"
    ? { credentialType: "api_key", apiKeyId: caller.actor.id, ...scopeIdsOf(caller) }
    : undefined;
}

function scopeIdsOf(caller: RestCaller): { projectId?: string; organizationId?: string } {
  const { scope } = caller;
  if (scope?.tier === "project") return { projectId: scope.id };
  if (scope?.tier === "organization") return { organizationId: scope.id };

  return {};
}
