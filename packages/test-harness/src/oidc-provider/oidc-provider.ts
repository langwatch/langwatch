/**
 * A stand-in OpenID Connect provider, for tests only: discovery, a key set, an authorization
 * redirect and a token endpoint trading a code once for an RS256 ID token, signed by a key made
 * per run. Spec: packages/test-harness/specs/oidc-provider.feature.
 */
import { createHash, generateKeyPairSync, randomBytes, sign, timingSafeEqual } from "node:crypto";
import type { KeyObject, webcrypto } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { nowInstant } from "@langwatch/time";

/** Who the provider signs in: the claims a real provider puts in the ID token and userinfo. */
export interface OidcSubject {
  sub: string;
  email: string;
  /** Defaults to `true`: the provider vouches for the address. */
  emailVerified?: boolean;
  name?: string;
  /** Further claims, merged over the standard ones. */
  claims?: Readonly<Record<string, unknown>>;
}

/** The signing key's public half as the key set publishes it: the RSA members plus its `kid`. */
export type OidcPublicJwk = webcrypto.JsonWebKey & { kid: string };

/** The one client registered at the provider, as the relying party is configured with it. */
export interface OidcClient {
  clientId: string;
  clientSecret: string;
}

export interface OidcProviderEndpoints {
  discovery: string;
  authorization: string;
  token: string;
  userInfo: string;
  jwks: string;
}

export interface OidcProvider {
  readonly issuer: string;
  readonly client: OidcClient;
  readonly endpoints: OidcProviderEndpoints;
  /** The public half of the signing key, as the key set publishes it. */
  readonly publicJwk: OidcPublicJwk;
  /** Whom the next authorization signs in; with nobody set it answers `access_denied`. */
  signInAs(subject: OidcSubject | null): void;
  /** Answers one request, so a test can inject the provider as a fetch instead of a port. */
  handle(request: Request): Promise<Response>;
  /** A fetch whose every request is answered by {@link handle}. */
  fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>;
}

export interface ServedOidcProvider extends OidcProvider {
  /** The loopback origin it listens on, as a relying party trusts it. */
  readonly origin: string;
  stop(): Promise<void>;
}

type IssuedCode = {
  subject: OidcSubject;
  redirectUri: string;
  nonce: string | null;
  codeChallenge: string | null;
  scope: string;
};

const TOKEN_LIFETIME_SECONDS = 300;

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });

const oauthError = (error: string, status = 400) => json({ error }, status);

const sameSecret = (given: string, expected: string) => {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

const base64UrlJson = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

/** A provider whose issuer is `issuer`; it answers through {@link OidcProvider.handle} only. */
export function createOidcProvider({
  issuer,
  client,
  subject = null,
}: {
  issuer: string;
  client: OidcClient;
  subject?: OidcSubject | null;
}): OidcProvider {
  return new InProcessOidcProvider({ issuer, client, subject });
}

class InProcessOidcProvider implements OidcProvider {
  readonly endpoints: OidcProviderEndpoints;
  readonly publicJwk: OidcPublicJwk;
  readonly issuer: string;
  readonly client: OidcClient;
  private readonly privateKey: KeyObject;
  private readonly kid = randomBytes(8).toString("hex");
  private readonly codes = new Map<string, IssuedCode>();
  private readonly accessTokens = new Map<string, OidcSubject>();
  private current: OidcSubject | null;

  constructor({
    issuer,
    client,
    subject,
  }: {
    issuer: string;
    client: OidcClient;
    subject: OidcSubject | null;
  }) {
    const base = issuer.replace(/\/$/, "");
    this.issuer = issuer;
    this.client = client;
    this.current = subject;
    this.endpoints = {
      discovery: `${base}/.well-known/openid-configuration`,
      authorization: `${base}/authorize`,
      token: `${base}/token`,
      userInfo: `${base}/userinfo`,
      jwks: `${base}/jwks`,
    };
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    this.privateKey = privateKey;
    this.publicJwk = {
      ...publicKey.export({ format: "jwk" }),
      kid: this.kid,
      alg: "RS256",
      use: "sig",
    };
  }

  signInAs(subject: OidcSubject | null): void {
    this.current = subject;
  }

  fetch = (input: string | URL | Request, init?: RequestInit): Promise<Response> =>
    this.handle(new Request(input, init));

  handle = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    switch (`${url.origin}${url.pathname}`) {
      case this.endpoints.discovery:
        return json(this.discovery());
      case this.endpoints.jwks:
        return json({ keys: [this.publicJwk] });
      case this.endpoints.authorization:
        return this.authorize(url.searchParams);
      case this.endpoints.token:
        return this.token(request);
      case this.endpoints.userInfo:
        return this.userInfo(request);
      default:
        return new Response(null, { status: 404 });
    }
  };

  private discovery() {
    return {
      issuer: this.issuer,
      authorization_endpoint: this.endpoints.authorization,
      token_endpoint: this.endpoints.token,
      userinfo_endpoint: this.endpoints.userInfo,
      jwks_uri: this.endpoints.jwks,
      response_types_supported: ["code"],
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["RS256"],
      scopes_supported: ["openid", "email", "profile"],
      token_endpoint_auth_methods_supported: ["client_secret_basic", "client_secret_post"],
      code_challenge_methods_supported: ["S256"],
      claims_supported: ["sub", "email", "email_verified", "name"],
    };
  }

  private authorize(query: URLSearchParams): Response {
    const redirectUri = query.get("redirect_uri");
    if (query.get("client_id") !== this.client.clientId || !redirectUri) {
      return oauthError("invalid_request");
    }
    if (!URL.canParse(redirectUri)) return oauthError("invalid_request");
    const back = new URL(redirectUri);
    const state = query.get("state");
    if (state !== null) back.searchParams.set("state", state);
    const refusal = authorizationRefusal({ query, subject: this.current });
    if (refusal) back.searchParams.set("error", refusal);
    else back.searchParams.set("code", this.issueCode({ query, redirectUri }));
    return Response.redirect(back, 302);
  }

  private issueCode({ query, redirectUri }: { query: URLSearchParams; redirectUri: string }) {
    const code = randomBytes(24).toString("base64url");
    this.codes.set(code, {
      subject: this.current!,
      redirectUri,
      nonce: query.get("nonce"),
      codeChallenge: query.get("code_challenge"),
      scope: query.get("scope") ?? "",
    });
    return code;
  }

  private async token(request: Request): Promise<Response> {
    if (request.method !== "POST") return oauthError("invalid_request", 405);
    const form = new URLSearchParams(await request.text());
    const credentials = clientCredentials({ request, form });
    if (credentials.id !== this.client.clientId || credentials.secret === null) {
      return oauthError("invalid_client", 401);
    }
    if (!sameSecret(credentials.secret, this.client.clientSecret)) {
      return oauthError("invalid_client", 401);
    }
    if (form.get("grant_type") !== "authorization_code") {
      return oauthError("unsupported_grant_type");
    }
    const code = form.get("code") ?? "";
    const issued = this.codes.get(code);
    this.codes.delete(code);
    if (!issued || !grantMatches({ issued, form })) return oauthError("invalid_grant");
    const accessToken = randomBytes(24).toString("base64url");
    this.accessTokens.set(accessToken, issued.subject);
    return json({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: TOKEN_LIFETIME_SECONDS,
      scope: issued.scope,
      id_token: this.idToken(issued),
    });
  }

  private userInfo(request: Request): Response {
    const bearer = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
    const subject = this.accessTokens.get(bearer);
    if (!subject) return json({ error: "invalid_token" }, 401, { "www-authenticate": "Bearer" });
    return json(profileClaims(subject));
  }

  private idToken({ subject, nonce }: IssuedCode): string {
    const issuedAt = Math.floor(nowInstant().epochMilliseconds / 1000);
    const header = base64UrlJson({ alg: "RS256", typ: "JWT", kid: this.kid });
    const payload = base64UrlJson({
      ...profileClaims(subject),
      iss: this.issuer,
      aud: this.client.clientId,
      azp: this.client.clientId,
      iat: issuedAt,
      auth_time: issuedAt,
      exp: issuedAt + TOKEN_LIFETIME_SECONDS,
      ...(nonce ? { nonce } : {}),
    });
    const signed = sign("sha256", Buffer.from(`${header}.${payload}`), this.privateKey);
    return `${header}.${payload}.${signed.toString("base64url")}`;
  }
}

/** The error a real provider redirects back with, or `null` to issue a code. */
function authorizationRefusal({
  query,
  subject,
}: {
  query: URLSearchParams;
  subject: OidcSubject | null;
}): string | null {
  if (query.get("response_type") !== "code") return "unsupported_response_type";
  const scopes = (query.get("scope") ?? "").split(" ");
  if (!scopes.includes("openid")) return "invalid_scope";
  const challenge = query.get("code_challenge");
  const method = query.get("code_challenge_method");
  if (challenge !== null && method !== "S256") return "invalid_request";
  return subject ? null : "access_denied";
}

/** The client's id and secret, from HTTP Basic (RFC 6749 §2.3.1) or the form body. */
function clientCredentials({ request, form }: { request: Request; form: URLSearchParams }) {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Basic ")) {
    return { id: form.get("client_id"), secret: form.get("client_secret") };
  }
  const [user = "", password = ""] = Buffer.from(header.slice(6), "base64").toString().split(":");
  return { id: decodeURIComponent(user), secret: decodeURIComponent(password) };
}

/** The redirect URL matches the authorization's, and the PKCE verifier hashes to its challenge. */
function grantMatches({ issued, form }: { issued: IssuedCode; form: URLSearchParams }): boolean {
  if (form.get("redirect_uri") !== issued.redirectUri) return false;
  if (!issued.codeChallenge) return true;
  const verifier = form.get("code_verifier") ?? "";
  return createHash("sha256").update(verifier).digest("base64url") === issued.codeChallenge;
}

function profileClaims(subject: OidcSubject): Record<string, unknown> {
  return {
    sub: subject.sub,
    email: subject.email,
    email_verified: subject.emailVerified ?? true,
    ...(subject.name ? { name: subject.name } : {}),
    ...subject.claims,
  };
}

/** Serves {@link createOidcProvider} on a loopback port; its issuer is that origin. */
export async function startOidcProvider({
  client,
  subject = null,
}: {
  client: OidcClient;
  subject?: OidcSubject | null;
}): Promise<ServedOidcProvider> {
  let provider: OidcProvider | undefined;
  const server = createServer((request, response) => {
    answer({ provider: provider!, request, response }).catch(() => response.writeHead(500).end());
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  provider = createOidcProvider({ issuer: origin, client, subject });

  return {
    issuer: provider.issuer,
    client: provider.client,
    endpoints: provider.endpoints,
    publicJwk: provider.publicJwk,
    signInAs: (next) => provider.signInAs(next),
    handle: (request) => provider.handle(request),
    fetch: (input, init) => provider.fetch(input, init),
    origin,
    stop: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function answer({
  provider,
  request,
  response,
}: {
  provider: OidcProvider;
  request: IncomingMessage;
  response: ServerResponse;
}): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (typeof value === "string") headers.set(name, value);
  }
  const method = request.method ?? "GET";
  const answered = await provider.handle(
    new Request(`http://${request.headers.host}${request.url ?? "/"}`, {
      method,
      headers,
      ...(method === "GET" || method === "HEAD" ? {} : { body: Buffer.concat(chunks) }),
    }),
  );
  response.writeHead(answered.status, Object.fromEntries(answered.headers));
  response.end(Buffer.from(await answered.arrayBuffer()));
}
