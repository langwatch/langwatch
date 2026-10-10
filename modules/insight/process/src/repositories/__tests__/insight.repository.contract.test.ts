/**
 * @vitest-environment node
 * Whose insights a read answers, stated once and run against both backends: the memory twin
 * always, and Postgres when a test database is named at `LANGWATCH_TEST_DATABASE_URL`.
 * @see modules/insight/specs/insight-inbox.feature
 */

import { randomUUID } from "node:crypto";

import { createTenantId, type StoredProjection } from "@langwatch/eventing";
import { InsightNotFoundError } from "@langwatch/insight-contract";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { createTestLogger } from "@langwatch/test-harness";
import { cleanupTestRows } from "@langwatch/test-harness/prisma";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import type { InsightReaderState } from "../../eventing/insight-reader.projection.ts";
import type { InsightState } from "../../eventing/insight.projection.ts";
import { insightReaderKey } from "../../rules/insight-reader-key.rules.ts";
import type { InsightRepositories } from "../insight.repositories.ts";
import { MemoryInsightRepositories } from "../memory/memory.insight.repositories.ts";
import { PostgresInsightRepositories } from "../prisma/prisma.insight.repositories.ts";

/** One backend under test: its repositories, and the two project ids the cases read against. */
type Backend = Readonly<{
  repositories: () => InsightRepositories;
  projectId: () => string;
  otherProjectId: () => string;
}>;

const OWNER = "user-owner";
const OTHER = "user-other";
const HOUR_MS = 3_600_000;
const FILED_AT = Date.UTC(2026, 9, 9, 7);

function folded<State>({ state, at }: { state: State; at: number }): StoredProjection<State> {
  return {
    state,
    cursor: { acceptedAt: at, eventId: `event_${randomUUID()}` },
    occurredAt: at,
    createdAt: at,
    updatedAt: at,
    version: "2026-10-09",
  };
}

/** An insight its owner saved from a chat; a case overrides whose it is and when it was filed. */
function insight(overrides: Partial<InsightState> = {}): InsightState {
  return {
    title: "Checkout errors doubled",
    body: "Checkout errors doubled overnight.",
    tone: "bad",
    topic: null,
    validDays: 7,
    lwql: null,
    replay: null,
    source: null,
    board: null,
    filedVia: "chat",
    ownerUserId: OWNER,
    filedByUserId: OWNER,
    filedAt: FILED_AT,
    renewedAt: null,
    ...overrides,
  };
}

/** What a refused single read answers, without the id that was asked for. */
async function refusalOf(read: Promise<unknown>) {
  const refusal: unknown = await read.then(
    () => {
      throw new Error("The read was not refused");
    },
    (error: unknown) => error,
  );
  if (!(refusal instanceof InsightNotFoundError)) throw refusal;
  return { code: refusal.code, message: refusal.message, httpStatus: refusal.httpStatus };
}

function contractCases(backend: Backend): void {
  /** Writes the insight row the way the fold does, and answers its id. */
  const file = async ({
    projectId = backend.projectId(),
    ...overrides
  }: Partial<InsightState> & { projectId?: string } = {}) => {
    const insightId = `insight_${randomUUID()}`;
    const state = insight(overrides);
    await backend.repositories().insightProjection.store(folded({ state, at: state.filedAt }), {
      tenantId: createTenantId(projectId),
      aggregateId: insightId,
      key: insightId,
    });
    return insightId;
  };

  /** Writes one reader's row on an insight the way the fold does. */
  const act = async ({
    insightId,
    userId,
    state,
  }: {
    insightId: string;
    userId: string;
    state: Partial<InsightReaderState>;
  }) =>
    backend.repositories().insightReaderProjection.store(
      folded({
        state: { seenAt: null, archivedAt: null, keptAt: null, ...state },
        at: FILED_AT,
      }),
      {
        tenantId: createTenantId(backend.projectId()),
        aggregateId: insightId,
        key: insightReaderKey({ insightId, userId }),
      },
    );

  const inboxOf = (userId: string) =>
    backend.repositories().insights.findForReader({
      projectId: backend.projectId(),
      userId,
      limit: 500,
    });

  const read = ({ insightId, userId }: { insightId: string; userId: string }) =>
    backend
      .repositories()
      .insights.getForReader({ projectId: backend.projectId(), insightId, userId });

  describe("when a member owns an insight", () => {
    /** @scenario "A single insight is read by its owner alone" */
    it("answers the owner the insight with their own state, and refuses another member as an unknown id", async () => {
      const insightId = await file();
      await act({ insightId, userId: OWNER, state: { seenAt: FILED_AT, keptAt: FILED_AT } });
      // A row the shared inbox left behind: another member's act on it moves nothing.
      await act({ insightId, userId: OTHER, state: { archivedAt: FILED_AT } });

      await expect(read({ insightId, userId: OWNER })).resolves.toMatchObject({
        id: insightId,
        ownerUserId: OWNER,
        seenAt: FILED_AT,
        archivedAt: null,
        keptAt: FILED_AT,
      });
      const unknown = await refusalOf(read({ insightId: "insight_unknown", userId: OTHER }));
      expect(unknown).toEqual({
        code: "insight_not_found",
        message: "Insight not found.",
        httpStatus: 404,
      });
      await expect(refusalOf(read({ insightId, userId: OTHER }))).resolves.toEqual(unknown);
    });

    it("lists it for the owner and for nobody else, in this project only", async () => {
      const insightId = await file();
      await file({ projectId: backend.otherProjectId() });

      await expect(inboxOf(OTHER)).resolves.toEqual([]);
      const owned = await inboxOf(OWNER);
      expect(owned.map((entry) => entry.id)).toEqual([insightId]);
      await expect(
        refusalOf(
          backend.repositories().insights.getForReader({
            projectId: backend.otherProjectId(),
            insightId,
            userId: OWNER,
          }),
        ),
      ).resolves.toMatchObject({ code: "insight_not_found" });
    });
  });

  describe("when the owner is not the person who filed the insight", () => {
    it("answers the owner and refuses the filer", async () => {
      const insightId = await file({ ownerUserId: OWNER, filedByUserId: OTHER });

      await expect(read({ insightId, userId: OWNER })).resolves.toMatchObject({ id: insightId });
      await expect(inboxOf(OTHER)).resolves.toEqual([]);
      await expect(refusalOf(read({ insightId, userId: OTHER }))).resolves.toMatchObject({
        code: "insight_not_found",
      });
    });
  });

  describe("when an insight names no owner and nobody who filed it", () => {
    it("answers it to nobody", async () => {
      const insightId = await file({ ownerUserId: null, filedByUserId: null });

      await expect(inboxOf(OWNER)).resolves.toEqual([]);
      await expect(refusalOf(read({ insightId, userId: OWNER }))).resolves.toMatchObject({
        code: "insight_not_found",
      });
    });
  });

  describe("when two members each filed insights in the project", () => {
    /** @scenario "A read's limit counts the owner's insights only" */
    it("answers a read limited to 2 the owner's own 2 newest", async () => {
      await file({ filedAt: FILED_AT });
      const second = await file({ filedAt: FILED_AT + HOUR_MS });
      const third = await file({ filedAt: FILED_AT + 2 * HOUR_MS });
      for (const hours of [3, 4, 5]) {
        await file({
          ownerUserId: OTHER,
          filedByUserId: OTHER,
          filedAt: FILED_AT + hours * HOUR_MS,
        });
      }

      const newest = await backend.repositories().insights.findForReader({
        projectId: backend.projectId(),
        userId: OWNER,
        limit: 2,
      });

      expect(newest.map((entry) => entry.id)).toEqual([third, second]);
    });
  });
}

describe("given the memory insight repositories", () => {
  let repositories: InsightRepositories;

  beforeEach(() => {
    repositories = MemoryInsightRepositories.create();
  });

  contractCases({
    repositories: () => repositories,
    projectId: () => "project-1",
    otherProjectId: () => "project-2",
  });
});

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createTestLogger().logger,
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }))
  : null;

function database(): PrismaClient {
  if (connection === null) throw new Error("LANGWATCH_TEST_DATABASE_URL is required here");
  return connection.client;
}

describe.skipIf(!databaseUrl)("given the Postgres insight repositories", () => {
  const projectId = `insight-contract-${randomUUID()}`;
  const otherProjectId = `${projectId}-other`;

  const clean = () =>
    cleanupTestRows(database(), [
      ["insightReaderProjection", { projectId }],
      ["insightReaderProjection", { projectId: otherProjectId }],
      ["insightProjection", { projectId }],
      ["insightProjection", { projectId: otherProjectId }],
    ]);

  beforeEach(clean);

  afterAll(async () => {
    try {
      await clean();
    } finally {
      await connection?.closeOnce();
    }
  });

  const repositories = () => PostgresInsightRepositories.create({ prisma: database() });

  contractCases({
    repositories,
    projectId: () => projectId,
    otherProjectId: () => otherProjectId,
  });

  describe("when an insight row was written before the owner column existed", () => {
    /** @scenario "An insight stored before owners existed belongs to whoever filed it" */
    it("answers it to the person who filed it, and to nobody else", async () => {
      const insightId = `insight_${randomUUID()}`;
      // The row as an image without the column writes it: no owner, only who filed it.
      await database().insightProjection.create({
        data: {
          id: insightId,
          projectId,
          title: "Checkout errors doubled",
          body: "Checkout errors doubled overnight.",
          tone: "bad",
          validDays: 7,
          filedByUserId: OWNER,
          filedAt: FILED_AT,
          createdAt: FILED_AT,
          updatedAt: FILED_AT,
          occurredAt: FILED_AT,
          acceptedAt: FILED_AT,
          lastEventId: "event-1",
          projectionVersion: "2026-10-09",
        },
      });
      const scope = { projectId, insightId };

      const owned = await repositories().insights.findForReader({
        projectId,
        userId: OWNER,
        limit: 500,
      });

      expect(owned).toEqual([expect.objectContaining({ id: insightId, ownerUserId: OWNER })]);
      await expect(
        repositories().insights.getForReader({ ...scope, userId: OWNER }),
      ).resolves.toMatchObject({ id: insightId, ownerUserId: OWNER });
      await expect(
        repositories().insights.findForReader({ projectId, userId: OTHER, limit: 500 }),
      ).resolves.toEqual([]);
      await expect(
        refusalOf(repositories().insights.getForReader({ ...scope, userId: OTHER })),
      ).resolves.toMatchObject({ code: "insight_not_found" });
    });
  });
});
