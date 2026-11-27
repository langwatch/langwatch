/**
 * The scoped project-keys copy on real Postgres: each organisation's login sees only its own
 * projects' capabilities, the capability is the app's sha256, and a project with no key is absent.
 * @see ../langwatch-ql-postgres-views.service.ts
 * @vitest-environment node
 */

import { createHash } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaLangWatchQLPostgresRepository } from "../../../../repositories/prisma/prisma.langwatch-ql-postgres.repository.ts";
import { LWQL_PROJECT_KEYS_VIEW } from "../../rules/lwql-scoped-view.rules.ts";
import {
  ADMIN,
  GROUP,
  PROJECT_A,
  PROJECT_B,
  provisioning,
  q,
  READER_A,
  READER_B,
  READER_NONE,
  SCHEMA,
  SCOPED,
  type ScopeHarness,
  startScopeHarness,
  SHARED_READER,
} from "./langwatch-ql-postgres-reader-scope.fixtures.ts";

/** The harness seeds each project's key as this; the copy must hold only its hash. */
const keyOf = (projectId: string): string => `excluded-lwqlkey-of-${projectId}`;
const sha256Hex = (value: string): string => createHash("sha256").update(value).digest("hex");

type KeyRow = { KeyHash: string; TenantId: string };

describe("given the scoped project-keys copy over two organisations", () => {
  let harness: ScopeHarness;
  const NO_KEY_PROJECT = `${PROJECT_A}-nokey`;

  async function keysSeenBy(user: string): Promise<{ rows: KeyRow[]; text: string }> {
    const text = await harness.runAs({
      user,
      sql:
        `SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x."TenantId"), '[]'::jsonb) ` +
        `FROM ${q(SCOPED)}.${q(LWQL_PROJECT_KEYS_VIEW)} x`,
    });

    return { rows: JSON.parse(text) as KeyRow[], text };
  }

  beforeAll(async () => {
    harness = await startScopeHarness();
    await harness.admin(
      `INSERT INTO ${q(SCHEMA)}."Project" ("id", "name", "slug", "apiKey", "lwqlKey", "teamId", ` +
        `"language", "framework") VALUES ('${NO_KEY_PROJECT}', 'No key', '${NO_KEY_PROJECT}-slug', ` +
        `'apikey-${NO_KEY_PROJECT}', '', '${PROJECT_A}-team', 'python', 'openai')`,
    );
    await harness.applyAll(provisioning.postgresProjectKeysStatements({ schema: SCHEMA }));
  }, 600_000);

  afterAll(async () => {
    await harness?.stop();
  });

  /** @scenario "The Postgres scoped schema carries a row-scoped copy of each project's key capability" */
  it("shows the first organisation's login only its own project's hash, as the app computes it", async () => {
    const seen = await keysSeenBy(READER_A);

    expect(seen.rows).toEqual([{ KeyHash: sha256Hex(keyOf(PROJECT_A)), TenantId: PROJECT_A }]);
  });

  /** @scenario "The Postgres scoped schema carries a row-scoped copy of each project's key capability" */
  it("shows the second organisation's login only its own project's hash", async () => {
    const seen = await keysSeenBy(READER_B);

    expect(seen.rows).toEqual([{ KeyHash: sha256Hex(keyOf(PROJECT_B)), TenantId: PROJECT_B }]);
  });

  /** @scenario "The Postgres scoped schema carries a row-scoped copy of each project's key capability" */
  it("shows a group member with no organisation role nothing", async () => {
    expect((await keysSeenBy(READER_NONE)).rows).toEqual([]);
  });

  /** @scenario "The Postgres scoped schema carries a row-scoped copy of each project's key capability" */
  it("exposes exactly KeyHash and TenantId, never the key, and omits a project with no key", async () => {
    const seen = await keysSeenBy(READER_A);

    expect(Object.keys(seen.rows[0] ?? {}).toSorted()).toEqual(["KeyHash", "TenantId"]);
    expect(seen.text).not.toContain(keyOf(PROJECT_A));
    expect(seen.rows.map((row) => row.TenantId)).not.toContain(NO_KEY_PROJECT);
  });

  /** @scenario "The Postgres scoped schema carries a row-scoped copy of each project's key capability" */
  it("passes the scoped-view guard and is granted, so a drift check never rebuilds it", async () => {
    const connection = harness.connect(ADMIN);
    try {
      const state = await PrismaLangWatchQLPostgresRepository.create(
        connection.database,
      ).findScopedViewState({
        appSchema: SCHEMA,
        group: GROUP,
        views: [LWQL_PROJECT_KEYS_VIEW],
      });

      expect(state.copies).toMatchObject([
        { view: LWQL_PROJECT_KEYS_VIEW, exists: true, passesGuard: true },
      ]);
    } finally {
      await connection.close();
    }
  });

  /** @scenario "The Postgres scoped schema carries a row-scoped copy of each project's key capability" */
  it("is not readable by the shared reader, which holds no grant on it", async () => {
    const granted = await harness.admin(
      `SELECT has_table_privilege('${SHARED_READER}', '${q(SCOPED)}.${q(LWQL_PROJECT_KEYS_VIEW)}', 'SELECT')`,
    );

    expect(granted).toBe("f");
  });
});
