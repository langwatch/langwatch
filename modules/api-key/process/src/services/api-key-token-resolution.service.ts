import { createHash } from "node:crypto";

import {
  apiKeyTokenResolutionInputSchema,
  apiKeyVerificationSchema,
  getTokenType,
  organizationApiKeyResolutionInputSchema,
  organizationApiKeyResolutionSchema,
  resolvedApiKeyTokenSchema,
  type ApiKey,
  type ApiKeyBinding,
  type OrganizationApiKeyResolution,
  type ResolvedApiKeyCredential,
  API_KEY_PREFIX,
  LANGY_SESSION_API_KEY_NAME,
  WORKFLOW_RUN_API_KEY_NAME,
} from "@langwatch/api-key-contract";
import type * as apiKeyContractModule from "@langwatch/api-key-contract";
import { createLogger } from "@langwatch/observability";
import { projectIdentitySchema, type ProjectIdentity } from "@langwatch/project-contract";
import { Temporal, fromDate, nowInstant, toDate, type Instant } from "@langwatch/time";
import { z } from "zod";

import {
  API_KEY_ANSWER_TTL_MS,
  API_KEY_UNKNOWN_TTL_MS,
  type ApiKeyAnswerCacheRepository,
} from "../repositories/api-key-answer-cache.repository.ts";
import type { ApiKeyRepository, StoredApiKey } from "../repositories/api-key.repository.ts";
import { ApiKeyGrantsService } from "./api-key-grants.service.ts";
import type { ApiKeyDependencies } from "./api-key.service.ts";

const logger = createLogger("langwatch:api-key:answers");

/** A key's answer and one project's identity, held under its public lookup id for a revoke. */
const heldVerificationSchema = z.object({
  tokenHash: z.string(),
  answer: apiKeyVerificationSchema,
  project: projectIdentitySchema.nullable(),
});
type HeldAnswer = Omit<z.infer<typeof heldVerificationSchema>, "tokenHash">;
const heldLegacySchema = z.object({ project: projectIdentitySchema.nullable() });
/** What a revoke leaves in a key's entry: a refusal that no late fill can overwrite. */
const REVOKED = "revoked";
/** The value a revoked legacy key's column holds; it never authenticates (ARCHITECTURE.md §10). */
const REVOKED_LEGACY_KEY_PREFIX = "lw-revoked-";
const DATE_FIELDS = new Set(["expiresAt", "revokedAt", "lastUsedAt", "createdAt", "updatedAt"]);

const verifiedKey = (lookupId: string) => `pat:${lookupId}`;
const unknownKey = (hash: string) => `unknown:${hash}`;
const legacyKey = (hash: string) => `legacy:${hash}`;

function publicApiKey(row: StoredApiKey): ApiKey {
  const { hashedSecret: _hashedSecret, ...key } = row;

  return key;
}

/**
 * Whether the key's own grants reach the project a caller named. An organization binding
 * reaches every project in it, a team binding every project on that team, a project binding
 * only its own.
 */
function bindingsReachProject(
  // The two fields the answer turns on, rather than the whole binding: the
  // verified key carries the schema's own rows, whose optional `customRoleId`
  // is not the narrowed one `ApiKeyBinding` states, and neither field below is
  // that one.
  bindings: readonly Pick<ApiKeyBinding, "scopeType" | "scopeId">[],
  project: ProjectIdentity,
): boolean {
  return bindings.some((binding) => {
    if (binding.scopeType === "ORGANIZATION") {
      return binding.scopeId === project.organizationId;
    }

    if (binding.scopeType === "TEAM") {
      return binding.scopeId === project.teamId;
    }

    return binding.scopeId === project.id;
  });
}

export class ApiKeyTokenResolutionService {
  static create(
    options: ApiKeyDependencies & {
      repository: ApiKeyRepository;
      answers: ApiKeyAnswerCacheRepository;
      now?: () => Instant;
    },
  ): ApiKeyTokenResolutionService {
    return new ApiKeyTokenResolutionService(options.repository, options.answers, options);
  }

  private readonly bindings: ApiKeyGrantsService;
  private readonly answerReads = new Map<string, Promise<HeldAnswer | null>>();
  private readonly legacyReads = new Map<string, Promise<ProjectIdentity | null>>();

  private constructor(
    private readonly repository: ApiKeyRepository,
    private readonly answers: ApiKeyAnswerCacheRepository,
    private readonly options: ApiKeyDependencies & { now?: () => Instant },
  ) {
    this.bindings = ApiKeyGrantsService.create({ authz: options.authz });
  }

  /**
   * A revoked key's shared answer becomes a refusal held as long as any answer, so a check that
   * read Postgres before the revoke cannot fill it again; a changed key's answer is deleted.
   */
  async forget({ lookupId, revoked }: { lookupId: string; revoked: boolean }): Promise<void> {
    const key = verifiedKey(lookupId);
    try {
      if (revoked) await this.answers.set({ key, value: REVOKED, ttlMs: API_KEY_ANSWER_TTL_MS });
      else await this.answers.delete({ key });
    } catch (error) {
      logger.error(
        { error, lookupId },
        "the shared answer of a changed API key could not be replaced; it lapses within its TTL",
      );
    }
  }

  async findVerifiedToken({
    token,
  }: {
    token: string;
  }): Promise<apiKeyContractModule.ApiKeyVerification | null> {
    return (await this.findAnswer({ token, projectId: null, withProject: false }))?.answer ?? null;
  }

  /**
   * Redis first, then Postgres. A held answer counts only for the exact token whose hash it
   * carries, so a wrong secret is verified in full; it lapses at the key's own expiry when
   * that comes sooner. A revoke's refusal is final. A failed read throws and nothing is held.
   */
  private async findAnswer(input: {
    token: string;
    projectId: string | null;
    withProject: boolean;
  }): Promise<HeldAnswer | null> {
    const lookupId = this.findTokenParts(input.token)?.lookupId;
    if (!lookupId) return null;

    const hash = tokenHash(input.token);
    for (const raw of await this.findHeld(verifiedKey(lookupId))) {
      if (raw === REVOKED) return null;
      const held = heldVerificationSchema.safeParse(parseHeld(raw));
      if (held.success && held.data.tokenHash === hash) {
        const answer = this.unexpired(held.data.answer);
        return answer ? { answer, project: held.data.project } : null;
      }
    }
    if ((await this.findHeld(unknownKey(hash))).length > 0) return null;

    const projectHint = input.withProject ? `project:${input.projectId ?? ""}` : "none";
    return shared({
      pending: this.answerReads,
      key: `${hash}:${projectHint}`,
      read: () => this.readAnswer({ ...input, lookupId, hash }),
    });
  }

  /** Reads Postgres, then fills the shared answer only where no entry (or refusal) exists. */
  private async readAnswer({
    token,
    projectId,
    withProject,
    lookupId,
    hash,
  }: {
    token: string;
    projectId: string | null;
    withProject: boolean;
    lookupId: string;
    hash: string;
  }): Promise<HeldAnswer | null> {
    const startedMs = this.nowMs();
    const answer = await this.readVerifiedToken({ token });
    if (!answer) {
      const ttlMs = this.sinceRead({ startedMs, ttlMs: API_KEY_UNKNOWN_TTL_MS });
      await this.hold({ key: unknownKey(hash), value: "1", ttlMs });
      return null;
    }
    const grantedProjectIds = findGrantedProjectIds(answer.grants);
    const soleProjectId = grantedProjectIds.length === 1 ? grantedProjectIds[0] : undefined;
    const heldProjectId = withProject ? (projectId ?? soleProjectId ?? null) : null;
    const project = heldProjectId ? await this.findProjectIdentity(heldProjectId) : null;
    const ttlMs = Math.min(
      this.sinceRead({ startedMs, ttlMs: API_KEY_ANSWER_TTL_MS }),
      answer.expiresAt ? answer.expiresAt.getTime() - this.nowMs() : API_KEY_ANSWER_TTL_MS,
    );
    const value = JSON.stringify({ tokenHash: hash, answer, project });
    await this.hold({ key: verifiedKey(lookupId), value, ttlMs });

    return { answer, project };
  }

  /** A held answer whose key expired since is refused, whatever the store's own clock says. */
  private unexpired(
    answer: apiKeyContractModule.ApiKeyVerification,
  ): apiKeyContractModule.ApiKeyVerification | null {
    return answer.expiresAt && answer.expiresAt.getTime() <= this.nowMs() ? null : answer;
  }

  private async readVerifiedToken({
    token,
  }: {
    token: string;
  }): Promise<apiKeyContractModule.ApiKeyVerification | null> {
    const split = this.findTokenParts(token);
    if (!split) {
      return null;
    }

    const row = await this.repository.findByLookupId({ lookupId: split.lookupId });
    const expired =
      row?.expiresAt != null && Temporal.Instant.compare(fromDate(row.expiresAt), this.now()) < 0;
    if (!row || row.revokedAt || expired) {
      return null;
    }

    // A key minted under a parent key (a CLI login key or a run's starting
    // key) cannot outlive it — the cascade retires it on revoke, but that is
    // one caller's work. A transient failure or a cascade-less revoke path
    // must not leave this key alive, so this checks the parent directly.
    if (row.parentApiKeyId && !(await this.isParentLive(row.parentApiKeyId))) {
      return null;
    }

    const verification = this.options.tokens.verify(split.secret, row.hashedSecret);
    if (verification === "no_match") {
      return null;
    }

    if (verification === "match_legacy") {
      void this.repository
        .upgradeHash({ id: row.id, hashedSecret: this.options.tokens.hash(split.secret) })
        .catch(() => void 0);
    }

    const key = publicApiKey(await this.bindings.attachOne(row));
    this.options.legacyGrants.mint(key);

    return { ...key, tokenType: "apiKey" };
  }

  async findResolvedToken(input: {
    token: string;
    projectId?: string | null;
  }): Promise<ResolvedApiKeyCredential | null> {
    const parsed = apiKeyTokenResolutionInputSchema.parse(input);
    const tokenType = getTokenType(parsed.token);

    if (tokenType === "legacyProjectKey") {
      return this.findLegacyProjectKeyResolution(parsed.token);
    }

    if (tokenType === "apiKey") {
      const resolved = await this.findCurrentApiKeyResolution(
        parsed.token,
        parsed.projectId ?? null,
      );
      if (resolved) {
        return resolved;
      }

      if (parsed.token.startsWith(API_KEY_PREFIX)) {
        return this.findLegacyProjectKeyResolution(parsed.token);
      }

      return null;
    }

    return this.findLegacyProjectKeyResolution(parsed.token);
  }

  async resolveOrganizationToken(input: { token: string }): Promise<OrganizationApiKeyResolution> {
    const parsed = organizationApiKeyResolutionInputSchema.parse(input);
    if (getTokenType(parsed.token) === "apiKey") {
      const apiKey = await this.findVerifiedToken({ token: parsed.token });
      if (apiKey) {
        return organizationApiKeyResolutionSchema.parse({
          ok: true,
          resolved: {
            type: "apiKey-org",
            apiKeyId: apiKey.id,
            userId: apiKey.userId,
            organizationId: apiKey.organizationId,
          },
        });
      }
    }

    const legacy = await this.findLegacyProjectKeyResolution(parsed.token);

    return organizationApiKeyResolutionSchema.parse(
      legacy
        ? { ok: false, reason: "wrong_credential_class" }
        : { ok: false, reason: "unusable_credential" },
    );
  }

  private findTokenParts(token: string): { lookupId: string; secret: string } | null {
    return this.options.tokens.findTokenParts(token);
  }

  /**
   * Whether the parent key a key was minted under is still live. A
   * parent that is gone reads as dead — its absence is not something to
   * authenticate past. Expiry counts too, ahead of the hourly sweep.
   */
  private async isParentLive(parentApiKeyId: string): Promise<boolean> {
    const parent = await this.repository.findLivenessById({ id: parentApiKeyId });
    if (!parent || parent.revokedAt) return false;
    return !(parent.expiresAt && Temporal.Instant.compare(parent.expiresAt, this.now()) < 0);
  }

  private async findLegacyProjectKeyResolution(
    token: string,
  ): Promise<ResolvedApiKeyCredential | null> {
    const project = await this.findLegacyProject(token);

    return project ? resolvedApiKeyTokenSchema.parse({ type: "legacyProjectKey", project }) : null;
  }

  private async findCurrentApiKeyResolution(
    token: string,
    projectId: string | null,
  ): Promise<ResolvedApiKeyCredential | null> {
    const held = await this.findAnswer({ token, projectId, withProject: true });
    if (!held) {
      return null;
    }
    const apiKey = held.answer;

    const grantedProjectIds = findGrantedProjectIds(apiKey.grants);
    const soleProjectId = grantedProjectIds.length === 1 ? grantedProjectIds[0] : undefined;
    const effectiveProjectId = projectId ?? soleProjectId;
    if (!effectiveProjectId) {
      return null;
    }

    const project =
      held.project?.id === effectiveProjectId
        ? held.project
        : await this.findProjectIdentity(effectiveProjectId);
    if (!project || project.organizationId !== apiKey.organizationId) {
      return null;
    }

    // Only a caller-NAMED project needs this: a self-scoped resolution derived
    // the project from a binding already.
    if (projectId && !bindingsReachProject(apiKey.grants, project)) {
      return null;
    }

    return resolvedApiKeyTokenSchema.parse({
      type: "apiKey",
      apiKeyId: apiKey.id,
      userId: apiKey.userId,
      organizationId: apiKey.organizationId,
      ingestSourceType: apiKey.ingestSourceType,
      ingestionTemplateId: apiKey.ingestionTemplateId,
      isLangySessionKey: apiKey.name === LANGY_SESSION_API_KEY_NAME,
      isUnattendedRunKey:
        apiKey.isSystemManaged === true &&
        apiKey.userId === null &&
        !apiKey.parentApiKeyId &&
        apiKey.name === WORKFLOW_RUN_API_KEY_NAME,
      project,
    });
  }

  /** A legacy key's project, held under the token's hash; a revoked column value never matches. */
  private async findLegacyProject(token: string): Promise<ProjectIdentity | null> {
    if (token.startsWith(REVOKED_LEGACY_KEY_PREFIX)) return null;

    const key = legacyKey(tokenHash(token));
    for (const raw of await this.findHeld(key)) {
      const held = heldLegacySchema.safeParse(parseHeld(raw));
      if (held.success) return held.data.project;
    }

    return shared({
      pending: this.legacyReads,
      key,
      read: () => this.readLegacyProject({ token, key }),
    });
  }

  private async readLegacyProject({
    token,
    key,
  }: {
    token: string;
    key: string;
  }): Promise<ProjectIdentity | null> {
    const startedMs = this.nowMs();
    const projectId = await this.options.projects.findIdByLegacyApiKey({ token });
    const project = projectId ? await this.findProjectIdentity(projectId) : null;
    await this.hold({
      key,
      value: JSON.stringify({ project }),
      ttlMs: this.sinceRead({
        startedMs,
        ttlMs: project ? API_KEY_ANSWER_TTL_MS : API_KEY_UNKNOWN_TTL_MS,
      }),
    });

    return project;
  }

  private findProjectIdentity(projectId: string): Promise<ProjectIdentity | null> {
    return this.options.projects.findIdentity(projectId);
  }

  /** An unreachable cache is a miss, never a refusal: Postgres answers instead. */
  private async findHeld(key: string): Promise<string[]> {
    try {
      return await this.answers.findValues({ key });
    } catch (error) {
      logger.warn({ error }, "the shared API-key answers could not be read; asking Postgres");
      return [];
    }
  }

  /**
   * What is left of `ttlMs` counted from when the Postgres read began, so a refusal or delete
   * written after the read began always outlives the fill it races.
   */
  private sinceRead({ startedMs, ttlMs }: { startedMs: number; ttlMs: number }): number {
    return ttlMs - (this.nowMs() - startedMs);
  }

  /** A fill never overwrites: an entry already there, a revoke's refusal included, wins. */
  private async hold(input: { key: string; value: string; ttlMs: number }): Promise<void> {
    if (input.ttlMs <= 0) return;
    try {
      await this.answers.set({ ...input, onlyIfAbsent: true });
    } catch (error) {
      logger.warn({ error }, "an API-key answer could not be shared; the next request reads again");
    }
  }

  private now(): Instant {
    return (this.options.now ?? nowInstant)();
  }

  private nowMs(): number {
    return this.now().epochMilliseconds;
  }
}

/** The distinct projects a key's own grants name; a key bound to exactly one answers it alone. */
function findGrantedProjectIds(
  bindings: readonly Pick<ApiKeyBinding, "scopeType" | "scopeId">[],
): string[] {
  const projectIds = new Set(
    bindings.flatMap((binding) =>
      binding.scopeType === "PROJECT" && binding.scopeId ? [binding.scopeId] : [],
    ),
  );

  return [...projectIds];
}

/** Concurrent reads of one token in this process share one promise, dropped once it settles. */
function shared<T>({
  pending,
  key,
  read,
}: {
  pending: Map<string, Promise<T>>;
  key: string;
  read: () => Promise<T>;
}): Promise<T> {
  const inFlight = pending.get(key);
  if (inFlight) return inFlight;

  const started = read().finally(() => pending.delete(key));
  pending.set(key, started);

  return started;
}

function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** JSON with the key's dates restored; anything unreadable is a miss. */
function parseHeld(raw: string): unknown {
  try {
    return JSON.parse(raw, (field, value: unknown) =>
      DATE_FIELDS.has(field) && typeof value === "string"
        ? toDate(Temporal.Instant.from(value))
        : value,
    );
  } catch {
    return undefined;
  }
}
