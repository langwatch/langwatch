import type { IdentifierFact } from "@langwatch/identity-contract";
import { IdentityIdentifierNotFoundError } from "@langwatch/identity-contract";
import { createTenantId, type StateProjectionStore } from "@langwatch/eventing";
import { describe, expect, it, vi } from "vitest";
import {
  type IdentityPipelineDatabase,
  PostgresIdentityPipelineAdapter,
} from "../postgres.identity-pipeline.adapter";
import type { IdentityFoldState } from "../../projections/identity-state.projection";
import type { IdentityPipeline } from "../identity-pipeline-definition.adapter";

const USER = "user_sam";
const IDENTIFIER = "idf_1";
const ACCOUNT = "acct_1";

/**
 * A recording stand-in for the composition root's typed client, ordered.
 *
 * The order matters as much as the calls: the cursor is the commit marker for
 * this fold, so a store that wrote it before the rows would turn a crash
 * mid-apply into a completed apply over a half-written projection.
 */
function recordingDatabase() {
  const calls: string[] = [];
  const record =
    <T>(name: string, result: T) =>
    async (..._args: unknown[]): Promise<T> => {
      calls.push(name);
      return result;
    };

  const identifierUpsert = vi.fn(record("identifier.upsert", undefined));
  const identifierFindMany = vi.fn(record("identifier.findMany", [] as unknown[]));
  const identifierFindFirst = vi.fn(record("identifier.findFirst", null));
  const cursorUpsert = vi.fn(record("cursor.upsert", undefined));
  const cursorFindUnique = vi.fn(record("cursor.findUnique", null));
  const reservationDeleteMany = vi.fn(record("reservation.deleteMany", { count: 0 }));
  const accountUpsert = vi.fn(record("account.upsert", undefined));
  const accountDeleteMany = vi.fn(record("account.deleteMany", { count: 0 }));
  const userFindUnique = vi.fn(record("user.findUnique", { id: USER }));

  const database = {
    identifier: {
      upsert: identifierUpsert,
      findMany: identifierFindMany,
      findFirst: identifierFindFirst,
    },
    identityProjectionCursor: { upsert: cursorUpsert, findUnique: cursorFindUnique },
    identifierReservation: { deleteMany: reservationDeleteMany },
    account: { upsert: accountUpsert, deleteMany: accountDeleteMany },
    user: {
      findUnique: userFindUnique,
      findFirst: vi.fn(record("user.findFirst", null)),
      updateMany: vi.fn(record("user.updateMany", { count: 0 })),
    },
    mfaEnrollment: {
      findUnique: vi.fn(record("mfa.findUnique", null)),
      upsert: vi.fn(record("mfa.upsert", undefined)),
    },
    $queryRaw: vi.fn(record("$queryRaw", [] as unknown[])),
  } as unknown as IdentityPipelineDatabase;

  return {
    database,
    calls,
    identifierUpsert,
    identifierFindMany,
    cursorUpsert,
    reservationDeleteMany,
    accountUpsert,
  };
}

function compose() {
  const recording = recordingDatabase();
  const pipeline: IdentityPipeline = PostgresIdentityPipelineAdapter.create({
    database: recording.database,
  }).build();
  return { ...recording, pipeline };
}

function identityStore(pipeline: IdentityPipeline): StateProjectionStore<IdentityFoldState> {
  const projection = pipeline.stateProjections?.get("identityState");
  expect(projection, "the pipeline registered no identityState projection").toBeDefined();
  return projection!.store as StateProjectionStore<IdentityFoldState>;
}

function verifiedIdentifier(overrides: Partial<IdentifierFact> = {}): IdentifierFact {
  return {
    identifierId: IDENTIFIER,
    userId: USER,
    provider: "email",
    value: "sam@acme.com",
    domain: "acme.com",
    identifierHash: null,
    accountId: ACCOUNT,
    providerId: "credential",
    issuer: null,
    providerAccountId: "sam@acme.com",
    connectionId: null,
    state: "VERIFIED",
    verifiedAtMs: 1_700_000_000_000,
    attachedAtMs: 1_600_000_000_000,
    detachedAtMs: null,
    ...overrides,
  } as IdentifierFact;
}

async function storeThrough(
  pipeline: IdentityPipeline,
  identifiers: IdentifierFact[],
): Promise<void> {
  await identityStore(pipeline).store(
    {
      state: {
        userId: USER,
        identifiers: Object.fromEntries(identifiers.map((fact) => [fact.identifierId, fact])),
        CreatedAt: 1_600_000_000_000,
        UpdatedAt: 1_700_000_000_000,
        LastEventOccurredAt: 1_700_000_000_000,
      },
      cursor: { acceptedAt: 1_700_000_000_500, eventId: "evt_1" },
      occurredAt: 1_700_000_000_000,
      createdAt: 1_600_000_000_000,
      updatedAt: 1_700_000_000_000,
      version: "1",
    },
    { aggregateId: USER, tenantId: createTenantId(USER) },
  );
}

describe("PostgresIdentityPipelineAdapter", () => {
  describe("given a process holding one typed Prisma client", () => {
    /**
     * Frozen twin: `PipelineRegistry.registerAll` builds the same pipeline
     * from `createIdentityPipeline`, and both graphs route
     * `${pipeline}:${jobType}:${jobName}` off one `event-sourcing/jobs`
     * queue. The names are LITERAL here rather than imported, because the
     * failure this catches is a rename that moved both the constant and its
     * use — the checked-in `apps/worker/src/features/job-registry.json` names
     * exactly these keys, and an unroutable job is redelivered forever rather
     * than dropped.
     */
    /** @scenario "The worker builds the identity ledger from its own client" */
    it("builds the pipeline the legacy registry registers, key for key", () => {
      const { pipeline } = compose();

      expect(pipeline.metadata.name).toBe("identity");
      expect(pipeline.commands.map((command) => command.name)).toEqual([
        "attachIdentifier",
        "verifyIdentifier",
        "markPrimary",
        "detachIdentifier",
        "eraseUser",
        "proposeLink",
        "enrollMfa",
        "confirmMfa",
        "expireMfaEnrollment",
        "disableMfa",
        "consumeBackupCode",
        "regenerateBackupCodes",
        "recordMfaVerificationFailure",
      ]);
      // Two folds on ONE aggregate (D06): an enrollment belongs to exactly
      // the person the identifiers belong to, so both share a per-person lane.
      expect([...(pipeline.stateProjections?.keys() ?? [])]).toEqual([
        "identityState",
        "mfaEnrollmentState",
      ]);
    });

    /** @scenario "The worker builds the identity ledger from its own client" */
    it("folds a user's identifiers onto that client, cursor last", async () => {
      const { pipeline, calls, identifierUpsert, cursorUpsert } = compose();

      await storeThrough(pipeline, [verifiedIdentifier()]);

      expect(identifierUpsert).toHaveBeenCalledTimes(1);
      const [request] = identifierUpsert.mock.calls[0] as unknown as [
        { where: { id: string }; create: Record<string, unknown> },
      ];
      expect(request.where).toEqual({ id: IDENTIFIER });
      expect(request.create).toMatchObject({
        id: IDENTIFIER,
        userId: USER,
        value: "sam@acme.com",
        state: "VERIFIED",
      });
      expect(cursorUpsert).toHaveBeenCalledTimes(1);
      // The commit marker goes last. A crash before it leaves rows a
      // re-applied event overwrites idempotently; a crash after it is a
      // completed apply.
      expect(calls.at(-1)).toBe("cursor.upsert");
    });

    /**
     * The fold RELEASES the address lock the guards claimed (ADR-116 §6). A
     * projection store composed without the lock would write every row this
     * test checks and route every key the parity guard checks, and the
     * customer's address would simply never become free again.
     */
    /** @scenario "The address lock the guards claim through is the one the fold releases through" */
    it("releases the address locks this user no longer backs", async () => {
      const { pipeline, reservationDeleteMany } = compose();

      await storeThrough(pipeline, [
        verifiedIdentifier(),
        verifiedIdentifier({
          identifierId: "idf_detached",
          state: "DETACHED",
          accountId: null,
          detachedAtMs: 1_700_000_000_100,
        }),
      ]);

      expect(reservationDeleteMany).toHaveBeenCalledWith({
        where: { userId: USER, identifierId: { notIn: [IDENTIFIER] } },
      });
    });

    /** @scenario "The worker builds the identity ledger from its own client" */
    it("runs the guards' reads over the same client the fold writes", async () => {
      const { pipeline, identifierFindMany } = compose();
      const markPrimary = pipeline.commands.find((command) => command.name === "markPrimary");
      expect(
        markPrimary?.handlerInstance,
        "markPrimary was registered without a guard",
      ).toBeDefined();

      await expect(
        (markPrimary!.handlerInstance as { handle(command: unknown): Promise<unknown> }).handle({
          data: {
            tenantId: USER,
            userId: USER,
            commandId: "cmd_1",
            identifierId: IDENTIFIER,
            occurredAtMs: 1_700_000_000_000,
            actor: { type: "user", id: USER },
          },
        }),
      ).rejects.toBeInstanceOf(IdentityIdentifierNotFoundError);

      expect(identifierFindMany).toHaveBeenCalledWith({ where: { userId: USER } });
    });
  });
});
