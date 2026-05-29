import crypto from "crypto";
import type { PrismaClient } from "@prisma/client";
import { decrypt } from "../../utils/encryption";
import { createLogger } from "../../utils/logger/server";

const logger = createLogger("langwatch:sso:oauth");

const STATE_COOKIE = "langwatch_sso_state";
const STATE_TTL_SECONDS = 600;

interface OidcEndpoints {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  userinfoEndpoint: string;
}

interface OAuthTokens {
  access_token: string;
  id_token?: string;
  token_type: string;
}

interface OAuthUserInfo {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
}

async function discoverOidcEndpoints({
  issuerUrl,
}: {
  issuerUrl: string;
}): Promise<OidcEndpoints> {
  const normalizedIssuer = issuerUrl.replace(/\/+$/, "");
  const discoveryUrl = `${normalizedIssuer}/.well-known/openid-configuration`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(discoveryUrl, {
      signal: controller.signal,
      redirect: "error",
    });

    if (!response.ok) {
      throw new Error(`Discovery returned ${response.status}`);
    }

    const config = (await response.json()) as Record<string, unknown>;

    const authorizationEndpoint = config.authorization_endpoint as string;
    const tokenEndpoint = config.token_endpoint as string;
    const userinfoEndpoint = config.userinfo_endpoint as string;

    if (!authorizationEndpoint || !tokenEndpoint || !userinfoEndpoint) {
      throw new Error("Missing required OIDC endpoints in discovery document");
    }

    return { authorizationEndpoint, tokenEndpoint, userinfoEndpoint };
  } finally {
    clearTimeout(timeout);
  }
}

function buildAzureAdEndpoints({
  tenantId,
}: {
  tenantId: string;
}): OidcEndpoints {
  const base = `https://login.microsoftonline.com/${tenantId}`;
  return {
    authorizationEndpoint: `${base}/oauth2/v2.0/authorize`,
    tokenEndpoint: `${base}/oauth2/v2.0/token`,
    userinfoEndpoint: "https://graph.microsoft.com/oidc/userinfo",
  };
}

function buildGoogleEndpoints(): OidcEndpoints {
  return {
    authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenEndpoint: "https://oauth2.googleapis.com/token",
    userinfoEndpoint: "https://openidconnect.googleapis.com/v1/userinfo",
  };
}

async function resolveEndpoints({
  provider,
  issuerUrl,
  tenantId,
}: {
  provider: string;
  issuerUrl: string | null;
  tenantId: string | null;
}): Promise<OidcEndpoints> {
  if (provider === "azure-ad") {
    if (!tenantId) throw new Error("Azure AD requires a tenant ID");
    return buildAzureAdEndpoints({ tenantId });
  }
  if (provider === "google") {
    return buildGoogleEndpoints();
  }
  if (!issuerUrl) {
    throw new Error(`Provider ${provider} requires an issuer URL`);
  }
  return discoverOidcEndpoints({ issuerUrl });
}

export function generateState(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function buildStateCookie({
  state,
  domain,
  secure,
}: {
  state: string;
  domain: string;
  secure: boolean;
}): string {
  const value = JSON.stringify({ state, domain });
  const encoded = Buffer.from(value).toString("base64url");
  const parts = [
    `${STATE_COOKIE}=${encoded}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${STATE_TTL_SECONDS}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function parseStateCookie(
  cookieHeader: string | undefined,
): { state: string; domain: string } | null {
  if (!cookieHeader) return null;

  const match = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${STATE_COOKIE}=`));

  if (!match) return null;

  try {
    const encoded = match.slice(STATE_COOKIE.length + 1);
    const decoded = Buffer.from(encoded, "base64url").toString("utf-8");
    const parsed = JSON.parse(decoded) as { state: string; domain: string };
    if (typeof parsed.state === "string" && typeof parsed.domain === "string") {
      return parsed;
    }
  } catch {
    // corrupted cookie
  }
  return null;
}

export function clearStateCookie({ secure }: { secure: boolean }): string {
  const parts = [
    `${STATE_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export async function buildAuthorizationUrl({
  prisma,
  domain,
  callbackUrl,
  state,
}: {
  prisma: PrismaClient;
  domain: string;
  callbackUrl: string;
  state: string;
}): Promise<{ url: string; organizationId: string }> {
  const connection = await prisma.ssoConnection.findFirst({
    where: { domain, verifiedAt: { not: null } },
  });

  if (!connection) {
    throw new Error(`No verified SSO connection for domain ${domain}`);
  }

  const endpoints = await resolveEndpoints({
    provider: connection.provider,
    issuerUrl: connection.issuerUrl,
    tenantId: connection.tenantId,
  });

  const params = new URLSearchParams({
    response_type: "code",
    client_id: connection.clientId,
    redirect_uri: callbackUrl,
    scope: "openid email profile",
    state,
  });

  return {
    url: `${endpoints.authorizationEndpoint}?${params.toString()}`,
    organizationId: connection.organizationId,
  };
}

export async function exchangeCodeForUser({
  prisma,
  domain,
  code,
  callbackUrl,
}: {
  prisma: PrismaClient;
  domain: string;
  code: string;
  callbackUrl: string;
}): Promise<{
  userInfo: OAuthUserInfo;
  organizationId: string;
  provider: string;
}> {
  const connection = await prisma.ssoConnection.findFirst({
    where: { domain, verifiedAt: { not: null } },
  });

  if (!connection) {
    throw new Error(`No verified SSO connection for domain ${domain}`);
  }

  let clientSecret: string;
  try {
    clientSecret = decrypt(connection.clientSecretEnc);
  } catch (err) {
    logger.error({ err, domain }, "Failed to decrypt client secret");
    throw new Error("SSO configuration error — contact your administrator");
  }

  const endpoints = await resolveEndpoints({
    provider: connection.provider,
    issuerUrl: connection.issuerUrl,
    tenantId: connection.tenantId,
  });

  const tokenResponse = await fetch(endpoints.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: callbackUrl,
      client_id: connection.clientId,
      client_secret: clientSecret,
    }),
  });

  if (!tokenResponse.ok) {
    const body = await tokenResponse.text();
    logger.error(
      { status: tokenResponse.status, body, domain },
      "Token exchange failed",
    );
    throw new Error("Failed to exchange authorization code");
  }

  const tokens = (await tokenResponse.json()) as OAuthTokens;

  const userInfoResponse = await fetch(endpoints.userinfoEndpoint, {
    headers: { Authorization: `${tokens.token_type} ${tokens.access_token}` },
  });

  if (!userInfoResponse.ok) {
    throw new Error("Failed to fetch user info from IdP");
  }

  const userInfo = (await userInfoResponse.json()) as OAuthUserInfo;

  if (!userInfo.email) {
    throw new Error("IdP did not return an email address");
  }

  return {
    userInfo,
    organizationId: connection.organizationId,
    provider: connection.provider,
  };
}
