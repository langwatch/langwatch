import { randomUUID } from "node:crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import { getServerAuthSession } from "~/server/auth";
import { prisma } from "~/server/db";
import { connection as redis } from "~/server/redis";
import { encrypt } from "~/utils/encryption";

/** Redis key prefix for MCP authorization codes. */
const REDIS_AUTH_CODE_PREFIX = "mcp:auth_code:";

/** Authorization code TTL in seconds (10 minutes). */
const AUTH_CODE_TTL_SECONDS = 600;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const session = await getServerAuthSession({ req, res });
  if (!session?.user?.id) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const {
    projectId,
    redirect_uri,
    state,
    code_challenge,
    code_challenge_method,
    client_id,
  } = req.body as {
    projectId?: string;
    redirect_uri?: string;
    state?: string;
    code_challenge?: string;
    code_challenge_method?: string;
    client_id?: string;
  };

  if (!projectId || !redirect_uri) {
    return res
      .status(400)
      .json({ error: "projectId and redirect_uri are required" });
  }

  // Validate redirect_uri scheme to prevent open redirect / XSS
  try {
    const redirectUrl = new URL(redirect_uri);
    if (!["http:", "https:"].includes(redirectUrl.protocol)) {
      return res
        .status(400)
        .json({ error: "redirect_uri must use http or https" });
    }
  } catch {
    return res.status(400).json({ error: "Invalid redirect_uri" });
  }

  // PKCE is required — reject without code_challenge
  if (!code_challenge) {
    return res
      .status(400)
      .json({ error: "code_challenge is required (PKCE S256)" });
  }

  // Validate the project belongs to the user (check team membership)
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      archivedAt: null,
      team: {
        members: {
          some: {
            user: {
              id: session.user.id,
            },
          },
        },
      },
    },
  });

  if (!project) {
    return res
      .status(403)
      .json({ error: "Project not found or you don't have access" });
  }

  // Generate a random authorization code
  const code = randomUUID();

  // Store in Redis with encrypted API key
  if (!redis) {
    return res.status(500).json({ error: "Redis is not available" });
  }

  const authCodeEntry = JSON.stringify({
    projectId: project.id,
    encryptedApiKey: encrypt(project.apiKey),
    codeChallenge: code_challenge ?? "",
    codeChallengeMethod: code_challenge_method ?? "S256",
    clientId: client_id ?? "",
    expiresAt: Date.now() + AUTH_CODE_TTL_SECONDS * 1000,
  });

  await redis.set(
    `${REDIS_AUTH_CODE_PREFIX}${code}`,
    authCodeEntry,
    "EX",
    AUTH_CODE_TTL_SECONDS,
  );

  // Build the redirect URL with code and state
  const redirectUrl = new URL(redirect_uri);
  redirectUrl.searchParams.set("code", code);
  if (state) {
    redirectUrl.searchParams.set("state", state);
  }

  return res.status(200).json({ redirect: redirectUrl.toString() });
}
