/**
 * A held key whose grants fold slower than one try's window still ends as one key: each retry
 * re-grants the same key, confirmed by what an earlier try appended. The ledger is a fake of
 * `AuthzApi` because the real adapter is private to `@langwatch/authz-process`.
 * @see modules/api-key/specs/api-key.feature
 */
import type { CreateHeldApiKeyInput } from "@langwatch/api-key-contract";
import { AuthzGrantNotConfirmedError, type AuthzApi } from "@langwatch/authz-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { MemorySharedCredentialStore } from "@langwatch/secrets/shared-credential";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryApiKeyAnswerCacheRepository } from "../../repositories/memory/memory.api-key-answer-cache.repository.ts";
import { MemoryApiKeyDatabase } from "../../repositories/memory/memory.api-key.database.ts";
import { MemoryApiKeyRepository } from "../../repositories/memory/memory.api-key.repository.ts";
import { ApiKeyTokenService } from "../api-key-token.service.ts";
import { ApiKeyService } from "../api-key.service.ts";
import { HELD_KEY_GRANT_RETRY_AFTER_MS, HeldKeyMintService } from "../held-key-mint.service.ts";
import { SharedKeyMintService } from "../shared-key-mint.service.ts";

const ORG_ID = "org_1";
/** The adapter's own read-your-writes window and pace (authz-grant.store.ts). */
const CONVERGENCE_TIMEOUT_MS = 10_000;
const CONVERGENCE_POLL_MS = 250;
/** Slower than the window, so no try ever sees its own append land. */
const FOLDS_MS = [25_000, 48_000];
const MAX_ATTEMPTS = 4;

/** A ledger whose every append lands `foldMs` after it was made. */
function slowFoldLedger(foldMs: number) {
  const roleAppends: { roleId: string; append: number }[] = [];
  const grantAppends: string[] = [];
  const roleConfirmations: { own: number; landedBy: number }[] = [];
  const attachAnswers: { attached: string[]; duplicates: string[] }[] = [];
  const defineRoleCalls: Parameters<AuthzApi["defineRole"]>[0][] = [];
  const attachCalls: Parameters<AuthzApi["attachBindings"]>[0][] = [];
  const landedRoles = new Map<string, { name: string; permissions: string; append: number }>();
  const landedGrants = new Map<string, string>();

  const fold = (land: () => void) => setTimeout(land, foldMs);

  async function confirm(check: () => boolean): Promise<void> {
    const deadline = Date.now() + CONVERGENCE_TIMEOUT_MS;
    let isConverged = check();
    while (!isConverged && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, CONVERGENCE_POLL_MS));
      isConverged = check();
    }
    if (!isConverged) throw new AuthzGrantNotConfirmedError();
  }

  const grants: Pick<AuthzApi, "defineRole" | "attachBindings"> = {
    async defineRole(call) {
      defineRoleCalls.push(call);
      const { roleId, name, permissions } = call;
      const append = roleAppends.length + 1;
      const wanted = [...permissions].toSorted().join(",");
      roleAppends.push({ roleId, append });
      fold(() => landedRoles.set(roleId, { name, permissions: wanted, append }));
      const matches = () => {
        const row = landedRoles.get(roleId);
        return row?.name === name && row.permissions === wanted;
      };
      await confirm(matches);
      roleConfirmations.push({ own: append, landedBy: landedRoles.get(roleId)?.append ?? 0 });
    },
    async attachBindings(call) {
      attachCalls.push(call);
      const { bindings, onDuplicate } = call;
      const identityOf = (binding: (typeof bindings)[number]) =>
        JSON.stringify([
          binding.principal,
          binding.role,
          binding.customRoleId ?? null,
          binding.scopeType,
          binding.scopeId,
        ]);
      const heldBy = (binding: (typeof bindings)[number]) =>
        onDuplicate === "skip" ? landedGrants.get(identityOf(binding)) : undefined;
      const duplicates = bindings.flatMap((binding) => heldBy(binding) ?? []);
      const fresh = bindings.filter((binding) => heldBy(binding) === undefined);
      for (const binding of fresh) {
        grantAppends.push(binding.bindingId);
        fold(() => landedGrants.set(identityOf(binding), binding.bindingId));
      }
      await confirm(() => fresh.every((binding) => landedGrants.has(identityOf(binding))));
      const answer = { attached: fresh.map((binding) => binding.bindingId), duplicates };
      attachAnswers.push(answer);
      return answer;
    },
  };

  return {
    grants,
    roleAppends,
    grantAppends,
    roleConfirmations,
    attachAnswers,
    defineRoleCalls,
    attachCalls,
  };
}

/** The key service as the app wires it (lifecycle and grant policy real) over the slow ledger. */
function createFixture(foldMs: number) {
  const memory = MemoryApiKeyDatabase.create();
  const ledger = slowFoldLedger(foldMs);
  let bindingCount = 0;
  const repository = MemoryApiKeyRepository.create({ memory });
  const apiKeys = ApiKeyService.create({
    repository,
    answers: MemoryApiKeyAnswerCacheRepository.create(),
    authz: createApiFixture<AuthzApi>({ listApiKeyBindings: async () => [] }),
    grants: createApiFixture<AuthzApi>(ledger.grants),
    organizations: createApiFixture<OrganizationApi>({}),
    projects: createApiFixture<ProjectApi>({}),
    bindingIds: {
      generateBindingId: () => {
        bindingCount += 1;
        return `rb_${bindingCount}`;
      },
    },
    legacyGrants: { mint: () => undefined },
    tokens: ApiKeyTokenService.create("test-pepper"),
  });
  const service = HeldKeyMintService.create({
    sharedKeys: SharedKeyMintService.create({ apiKeys, keys: repository }),
    keys: repository,
    held: MemorySharedCredentialStore.create(),
  });
  return { service, memory, ledger };
}

/** Moves the fake clock in poll-sized steps until `work` settles, as wall time would. */
async function settle<T>(work: Promise<T>): Promise<T> {
  let settled = false;
  const tracked = work.finally(() => {
    settled = true;
  });
  // Observed here so a rejection is not reported as unhandled before the caller awaits it.
  tracked.catch(() => undefined);
  for (let tick = 0; !settled && tick < 1_000; tick += 1) {
    await vi.advanceTimersByTimeAsync(CONVERGENCE_POLL_MS);
  }
  return tracked;
}

/** The wait a retryable refusal names; null for anything the outbox gives up on. */
function retryAfterOf(error: unknown): number | null {
  return AuthzGrantNotConfirmedError.is(error) && error.retryable
    ? (error.retryAfterMs ?? 0)
    : null;
}

/** The outbox: the same call again after the pace the refusal names, until attempts run out. */
async function outbox<T>(run: () => Promise<T>) {
  const waits: number[] = [];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return { result: await settle(run()), attempts: attempt, waits };
    } catch (error) {
      const wait = retryAfterOf(error);
      if (wait === null || attempt === MAX_ATTEMPTS) throw error;
      waits.push(wait);
      await vi.advanceTimersByTimeAsync(wait);
    }
  }
  throw new Error("The outbox ran out of attempts without an answer");
}

const key: CreateHeldApiKeyInput["key"] = {
  name: "Workflow run",
  organizationId: ORG_ID,
  userId: null,
  createdByUserId: null,
  isSystemManaged: true,
  permissionMode: "restricted",
  permissions: ["traces:view"],
  bindings: [{ role: "CUSTOM", scopeType: "ORGANIZATION", scopeId: ORG_ID }],
  expiresAt: new Date("2026-10-01T16:00:00.000Z"),
};

describe("HeldKeyMintService over a ledger that folds slower than one try", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-01T10:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe.each(FOLDS_MS)(
    "given the role and the attach each land %i ms after their append",
    (foldMs) => {
      describe("when the outbox retries at the pace each refusal names", () => {
        /** @scenario "A held key's grants that land after a slow fold still let the caller proceed" */
        it("confirms a retry's re-grant from the role and attach the earlier attempt landed", async () => {
          const { service, memory, ledger } = createFixture(foldMs);

          const { result, attempts, waits } = await outbox(() =>
            service.createHeld({ holdKey: "run-1", key }),
          );

          expect(waits).toEqual([HELD_KEY_GRANT_RETRY_AFTER_MS, HELD_KEY_GRANT_RETRY_AFTER_MS]);
          expect(attempts).toBe(3);
          // Written by try 1, activated by try 3: one mint.
          expect(result.created).toBe(true);
          const rows = memory.keys();
          expect(rows.map((row) => row.id)).toEqual([result.apiKeyId]);
          expect(rows[0]?.revokedAt).toBeNull();
          // Every try re-defines the key's one role; none names another.
          expect(new Set(ledger.roleAppends.map((append) => append.roleId))).toEqual(
            new Set([`apikey:${result.apiKeyId}`]),
          );
          // The second try's role is confirmed by the first try's, the third's by the second's.
          expect(ledger.roleConfirmations).toEqual([
            { own: 2, landedBy: 1 },
            { own: 3, landedBy: 2 },
          ]);
          // The binding is appended once; the last try finds it landed and appends nothing.
          const [bindingId] = ledger.grantAppends;
          expect(ledger.grantAppends).toEqual([expect.stringMatching(/^rolebinding_/)]);
          expect(ledger.attachAnswers).toEqual([{ attached: [], duplicates: [bindingId] }]);
        });
      });
    },
  );

  describe("given the role and the attach each land 25000 ms after their append", () => {
    describe("when the outbox retries until the grant is read back", () => {
      /** @scenario "A held key's retries send its own role and grant under the same ids" */
      it("sends the key's stable ids on every try, and the same role and binding", async () => {
        const { service, ledger, memory } = createFixture(25_000);

        const { result } = await outbox(() => service.createHeld({ holdKey: "run-1", key }));
        // The key's creation, read back on every reopen: each try's business time.
        const occurredAtMs = memory.keys()[0]?.createdAt.getTime();
        expect(occurredAtMs).toEqual(expect.any(Number));

        // Mirrored by the replay in modules/authz/process/src/app/__tests__/
        // authz-api-key-own-grant.app.integration.test.ts (`grantKey`): keep the two in step.
        const roleId = `apikey:${result.apiKeyId}`;
        const actor = { type: "system", id: null };
        const commandId = ledger.defineRoleCalls[0]?.commandId;
        const bindingId = ledger.attachCalls[0]?.bindings[0]?.bindingId;
        expect(commandId).toMatch(new RegExp(`^apikeygrant:${result.apiKeyId}:[0-9a-f]{32}$`));
        expect(bindingId).toMatch(/^rolebinding_/);
        const role = {
          organizationId: ORG_ID,
          roleId,
          name: roleId,
          permissions: ["traces:view"],
          kind: "system_api_key",
          actor,
          commandId,
          occurredAtMs,
          requireProjection: true,
        };
        const attach = {
          organizationId: ORG_ID,
          bindings: [
            {
              bindingId,
              principal: { apiKeyId: result.apiKeyId },
              role: "CUSTOM",
              customRoleId: roleId,
              scopeType: "ORGANIZATION",
              scopeId: ORG_ID,
            },
          ],
          caller: { type: "system" },
          actor,
          source: "grants-service",
          onDuplicate: "skip",
          commandId,
          occurredAtMs,
          requireProjection: true,
        };
        // Try 1 stops at the role; tries 2 and 3 reach the attach. Nothing differs between tries.
        expect(ledger.defineRoleCalls).toStrictEqual([role, role, role]);
        expect(ledger.attachCalls).toStrictEqual([attach, attach]);
      });
    });
  });
});
