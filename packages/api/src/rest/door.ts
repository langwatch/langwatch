/**
 * A module-bound door, typed by the credential it opens and the Api it needs (ARCHITECTURE.md §8,
 * Alex 2026-10-10 TYPED-DOORS, W02-DOOR-BEARER): the framework pulls the bearer off the request
 * once and hands it in; the door reads no `Authorization` header and answers the scope it resolved.
 */
import type { Actor, AuthzDeclaredScopeId } from "@langwatch/authorization";
import type { FeatureApiIdentity, ModuleApiToken, ModuleName } from "@langwatch/module";

import type { RestCaller } from "../hosting/api-door.ts";
import { bearerTokenOf } from "./bearer-identity.ts";
import type { RestDoor } from "./request.ts";
import type { RestProtocolRefusal } from "./response-kind.ts";
import { collectAuthDiagnostics, type AuthDiagnostics } from "./security.ts";

/** Per module-bound credential: its scope's tier, what the framework reads beside the bearer, and
 * the session it hands over. */
export type DoorContract = {
  scim_token: {
    tier: "organization";
    presented: Readonly<Record<never, never>>;
    session: undefined;
  };
  licence_token: {
    tier: "organization";
    presented: Readonly<{ instanceId: string | null; path: string }>;
    session: unknown;
  };
  session_key: {
    tier: "project";
    /** Main's session core: Basic `base64(projectId:token)`, then Bearer with x-project-id. */
    presented: Readonly<{
      sessionKey: Readonly<{ token: string; projectId: string | null }> | null;
    }>;
    session: unknown;
  };
  otlp_ingest: {
    tier: "project";
    /** Main's OTLP key also arrives as Basic or `X-Auth-Token`, so the raw values come too. */
    presented: Readonly<{
      authorization: string | null;
      xAuthToken: string | null;
      xProjectId: string | null;
      diagnostics: AuthDiagnostics;
    }>;
    session: unknown;
  };
};

export type DoorCredential = keyof DoorContract;

/** What a door's `identify` is handed: the bearer, the request, and its contract's own reads. */
export type DoorPresented<Credential extends DoorCredential> = Readonly<{
  bearer: string | null;
  request: Request;
  rawBody?: string | Uint8Array;
}> &
  DoorContract[Credential]["presented"];

/** What a door answers: the scope at its contract's tier, the actor if any, and its session. */
export type DoorIdentified<Credential extends DoorCredential> = Readonly<{
  scope: Extract<AuthzDeclaredScopeId, { tier: DoorContract[Credential]["tier"] }>;
  actor?: Actor | null;
  session?: DoorContract[Credential]["session"];
}>;

/** The Api a module token stands for. */
export type ApiOfToken<Token> = Token extends ModuleApiToken<infer Api, ModuleName> ? Api : never;

export type RestDoorDefinition<
  Credential extends DoorCredential,
  Needs extends FeatureApiIdentity,
> = Readonly<{
  credential: Credential;
  needs: Needs;
  open(service: ApiOfToken<Needs>): RestDoor;
}>;

/**
 * Any door, as the module installer holds it once the builder checked its credential and Api: a
 * method, so the parameter stays bivariant, as `StoredHandlerArguments` (declaration.ts) does.
 */
export type ErasedRestDoorDefinition = Readonly<{
  credential: DoorCredential;
  needs: FeatureApiIdentity;
  open(service: unknown): RestDoor;
}>;

const PRESENTED: {
  [Credential in DoorCredential]: (request: Request) => DoorContract[Credential]["presented"];
} = {
  scim_token: () => ({}),
  licence_token: (request) => ({
    instanceId: request.headers.get("x-langwatch-instance"),
    path: new URL(request.url).pathname,
  }),
  session_key: (request) => ({
    sessionKey: sessionKeyOf({
      authorization: request.headers.get("authorization") ?? "",
      projectId: request.headers.get("x-project-id"),
    }),
  }),
  otlp_ingest: (request) => ({
    authorization: request.headers.get("authorization"),
    xAuthToken: request.headers.get("x-auth-token"),
    xProjectId: request.headers.get("x-project-id"),
    diagnostics: collectAuthDiagnostics({
      path: new URL(request.url).pathname,
      method: request.method,
      header: (name) => request.headers.get(name) ?? undefined,
    }),
  }),
};

/** Declares a door a module binds with `.withDoors({ [credential]: door })`. */
export function defineRestDoor<
  const Credential extends DoorCredential,
  Needs extends FeatureApiIdentity,
>(
  credential: Credential,
  {
    needs,
    identify,
    refusal,
  }: {
    needs: Needs;
    identify: (
      presented: DoorPresented<Credential>,
      service: ApiOfToken<Needs>,
    ) => Promise<DoorIdentified<Credential>>;
    /** Writes every refusal behind the door in its family's own wire (Q31). */
    refusal?: RestProtocolRefusal;
  },
): RestDoorDefinition<Credential, Needs> {
  return Object.freeze({
    credential,
    needs,
    open: (service: ApiOfToken<Needs>): RestDoor => ({
      ...(refusal ? { refusal } : {}),
      authenticate: () => {
        throw new Error(`The ${credential} door asks no permission of the caller it identifies.`);
      },
      identify: async ({ request, rawBody }): Promise<RestCaller> => {
        const identified = await identify(
          {
            bearer: bearerTokenOf(request.headers.get("authorization")),
            request,
            ...(rawBody === undefined ? {} : { rawBody }),
            ...PRESENTED[credential](request),
          },
          service,
        );

        return {
          actor: identified.actor ?? null,
          scope: identified.scope,
          ...(identified.session === undefined ? {} : { session: identified.session }),
        };
      },
    }),
  });
}

/** Main's `extractCredentials` over `authorization` alone; `X-Auth-Token` never carried one. */
function sessionKeyOf({
  authorization,
  projectId,
}: {
  authorization: string;
  projectId: string | null;
}): DoorContract["session_key"]["presented"]["sessionKey"] {
  const scheme = authorization.toLowerCase();

  if (scheme.startsWith("basic ")) {
    const decoded = Buffer.from(authorization.slice("basic ".length), "base64").toString("utf-8");
    const separator = decoded.indexOf(":");
    const basicProjectId = separator === -1 ? "" : decoded.slice(0, separator);
    const basicToken = separator === -1 ? "" : decoded.slice(separator + 1);
    if (basicProjectId !== "" && basicToken !== "") {
      return { token: basicToken, projectId: basicProjectId };
    }
  }

  const bearer = bearerTokenOf(authorization);

  return bearer === null ? null : { token: bearer, projectId };
}
