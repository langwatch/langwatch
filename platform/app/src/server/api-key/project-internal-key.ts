import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "~/generated/prisma/client";
import { decrypt, encrypt } from "~/utils/encryption";
import { generateApiKey } from "../utils/apiKeyGenerator";
import { hashProjectApiKey } from "./project-api-key";

const logger = createLogger("langwatch:api-key:project-internal-key");

function newInternalKey(): {
  token: string;
  tokenHash: string;
  tokenEncrypted: string;
} {
  const token = generateApiKey();
  return {
    token,
    tokenHash: hashProjectApiKey(token),
    tokenEncrypted: encrypt(token),
  };
}

/**
 * The token LangWatch's own services authenticate with when they act as a
 * project: the workflow engine, scenario runs, the AI gateway's trace export,
 * the checkup canaries and MCP sessions.
 *
 * It authenticates exactly like the project API key (see
 * `findProjectByApiKey`), but it is a different secret. The project API key is
 * stored as a hash only, so it cannot be handed on; this one is minted on
 * first use, held encrypted, and never shown to anyone. Rotating the project
 * API key leaves it alone, so a rotation never breaks a running workflow or a
 * gateway that is exporting traces.
 *
 * Never return it to a browser, a CLI or any other client.
 */
export async function getProjectInternalKey({
  prisma,
  projectId,
}: {
  prisma: PrismaClient;
  projectId: string;
}): Promise<string> {
  const existing = await prisma.projectInternalKey.findUnique({
    where: { projectId },
  });
  if (existing) {
    try {
      return decrypt(existing.tokenEncrypted);
    } catch (error) {
      // The instance's encryption key changed since the token was stored.
      // Replace it: nothing outside the server holds this token.
      logger.warn(
        { projectId, error },
        "the project internal key could not be read; replacing it",
      );
      const replacement = newInternalKey();
      await prisma.projectInternalKey.update({
        where: { projectId },
        data: {
          tokenHash: replacement.tokenHash,
          tokenEncrypted: replacement.tokenEncrypted,
        },
      });
      return replacement.token;
    }
  }

  const minted = newInternalKey();
  // Two callers can mint at once. The upsert keeps whichever row landed
  // first, and every caller returns the token of that row.
  const row = await prisma.projectInternalKey.upsert({
    where: { projectId },
    create: {
      projectId,
      tokenHash: minted.tokenHash,
      tokenEncrypted: minted.tokenEncrypted,
    },
    update: {},
  });
  return row.tokenHash === minted.tokenHash
    ? minted.token
    : decrypt(row.tokenEncrypted);
}
