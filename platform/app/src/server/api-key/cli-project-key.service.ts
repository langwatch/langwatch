import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "~/generated/prisma/client";
import { decrypt, encrypt } from "~/utils/encryption";
import { TtlCache } from "../utils/ttlCache";
import { ApiKeyService } from "./api-key.service";
import { CLI_PROJECT_KEY_NAME_PREFIX } from "./reserved-names";

const logger = createLogger("langwatch:api-key:cli-project-key");

/**
 * How long a handed-out token is held for re-sending. Past it, the next call
 * mints a new key; the old one keeps working until it is revoked or its
 * session ends.
 */
export const CLI_PROJECT_KEY_REUSE_MS = 30 * 24 * 60 * 60 * 1000;

const CLI_PROJECT_KEY_CACHE_PREFIX = "ttlcache:cli-project-key:";

/**
 * Handed-out tokens, encrypted, keyed by session (or by device when there is
 * no session key) and project. Postgres holds only each token's hash, so this
 * is the one place the plaintext survives past the mint, and only for the
 * reuse window.
 */
const heldTokens = new TtlCache<string>(
  CLI_PROJECT_KEY_REUSE_MS,
  CLI_PROJECT_KEY_CACHE_PREFIX,
);

interface IssueParams {
  userId: string;
  organizationId: string;
  project: { id: string; name: string };
  deviceLabel: string;
}

/**
 * The API key `langwatch login` hands a person for one project, in place of
 * the project API key (which is stored as a hash and cannot be handed out).
 *
 * The key is the shape a person creates on Settings > API Keys: owned by the
 * person, an ADMIN binding on the one project, permission mode `all`. Bound to
 * a single project, it authenticates without naming a project (the token
 * resolver scopes it to that project), so a CLI that writes it to
 * `LANGWATCH_API_KEY` works exactly as it did with the project API key.
 *
 * The CLI asks again on every session check (`GET /api/auth/cli/personal-project`,
 * every few minutes) and on every `langwatch langy` start, so a mint per call
 * would pile keys up. The token is therefore held encrypted in a `TtlCache`
 * for {@link CLI_PROJECT_KEY_REUSE_MS} (the agent sandbox key's pattern) and
 * re-sent from there while the key is still live. Once the entry is gone, or
 * the key behind it was revoked, the next call mints a new key.
 *
 * Two lifecycles:
 *   - {@link issueUnderSession}: one key per device session and project,
 *     minted under the session's CLI login key, so it lives and dies with the
 *     session. Re-login, logout, the devices tab and the session-expiry sweep
 *     revoke the login key and the keys under it, and `ApiKeyService.verify`
 *     refuses a key whose parent is dead in any case.
 *   - {@link issue}: a key that outlives the session (it lands in a `.env`),
 *     long-lived like any key a person creates, one per device and project
 *     per reuse window, revoked from the API keys page.
 *
 * Spec: specs/api-keys/project-key-hashed-storage.feature
 */
export class CliProjectKeyService {
  private readonly prisma: PrismaClient;
  private readonly apiKeys: ApiKeyService;
  private readonly cache: TtlCache<string>;

  constructor({
    prisma,
    apiKeys,
    cache = heldTokens,
  }: {
    prisma: PrismaClient;
    apiKeys: ApiKeyService;
    cache?: TtlCache<string>;
  }) {
    this.prisma = prisma;
    this.apiKeys = apiKeys;
    this.cache = cache;
  }

  static create(prisma: PrismaClient): CliProjectKeyService {
    return new CliProjectKeyService({
      prisma,
      apiKeys: ApiKeyService.create(prisma),
    });
  }

  /**
   * The person's long-lived CLI key for the project: the one held for this
   * device, when it still authenticates, or a new one.
   *
   * Throws `ApiKeyScopeViolationError` when the person does not hold ADMIN on
   * the project, the same refusal the API keys page gives.
   */
  async issue(params: IssueParams): Promise<{ token: string }> {
    const { userId, organizationId, project, deviceLabel } = params;
    return await this.heldOrMinted({
      ...params,
      cacheKey: `device:${organizationId}:${userId}:${deviceLabel}:${project.id}`,
      parentApiKeyId: null,
    });
  }

  /**
   * The session's key for the project: the one held for this session, when
   * it still authenticates, or a new one minted under the session's login
   * key. Null when that login key has ended (a newer login from the same
   * device replaced it, or it was revoked or ran out): a key minted under it
   * would authenticate nothing.
   *
   * Throws `ApiKeyScopeViolationError` like {@link issue}.
   */
  async issueUnderSession(
    params: IssueParams & { loginApiKeyId: string },
  ): Promise<{ token: string } | null> {
    const { organizationId, project, loginApiKeyId } = params;
    if (!(await this.isLive({ apiKeyId: loginApiKeyId, organizationId }))) {
      return null;
    }
    return await this.heldOrMinted({
      ...params,
      cacheKey: `session:${loginApiKeyId}:${project.id}`,
      parentApiKeyId: loginApiKeyId,
    });
  }

  private async heldOrMinted({
    userId,
    organizationId,
    project,
    deviceLabel,
    cacheKey,
    parentApiKeyId,
  }: IssueParams & {
    cacheKey: string;
    parentApiKeyId: string | null;
  }): Promise<{ token: string }> {
    const held = await this.readHeld({ cacheKey, userId, organizationId });
    if (held) return { token: held };

    const created = await this.apiKeys.create({
      name: `${CLI_PROJECT_KEY_NAME_PREFIX}${project.name} (${deviceLabel})`,
      description:
        "Created by langwatch login for this project. Revoke it here to sign the CLI out of the project.",
      userId,
      createdByUserId: userId,
      organizationId,
      permissionMode: "all",
      bindings: [{ role: "ADMIN", scopeType: "PROJECT", scopeId: project.id }],
      createdByDeviceLabel: deviceLabel,
      parentApiKeyId,
    });
    await this.cache.set(cacheKey, encrypt(created.token));
    return { token: created.token };
  }

  /**
   * The held token, when it can be read and still authenticates as this
   * person: a key revoked from the API keys page, or one whose session ended,
   * is never re-sent.
   */
  private async readHeld({
    cacheKey,
    userId,
    organizationId,
  }: {
    cacheKey: string;
    userId: string;
    organizationId: string;
  }): Promise<string | null> {
    const held = await this.cache.get(cacheKey);
    if (held === undefined) return null;
    let token: string;
    try {
      token = decrypt(held);
    } catch {
      logger.warn(
        { cacheKey },
        "a held CLI project key could not be read; minting a new one",
      );
      return null;
    }
    const key = await this.apiKeys.verify({ token });
    if (
      !key ||
      key.userId !== userId ||
      key.organizationId !== organizationId
    ) {
      await this.cache.delete(cacheKey);
      return null;
    }
    return token;
  }

  private async isLive({
    apiKeyId,
    organizationId,
  }: {
    apiKeyId: string;
    organizationId: string;
  }): Promise<boolean> {
    const key = await this.prisma.apiKey.findFirst({
      where: { id: apiKeyId, organizationId },
      select: { revokedAt: true, expiresAt: true },
    });
    if (!key || key.revokedAt) return false;
    return !(key.expiresAt && key.expiresAt <= new Date());
  }
}
