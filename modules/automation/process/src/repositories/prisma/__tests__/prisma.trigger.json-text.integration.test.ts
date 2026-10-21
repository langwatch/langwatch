/**
 * @vitest-environment node
 * The live trigger repository's JSON-text unwrap against Postgres (`LANGWATCH_TEST_DATABASE_URL`).
 * Spec: modules/automation/specs/automation.feature (the JSON-text step).
 */
import { randomUUID } from "node:crypto";

import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { frozenAt } from "@langwatch/test-harness";
import { cleanupTestRows } from "@langwatch/test-harness/prisma";
import { nowInstant } from "@langwatch/time";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TriggerJsonTextUnwrapService } from "../../../services/trigger-json-text-unwrap.service.ts";
import { PrismaTriggerRepository } from "../prisma.trigger.repository.ts";

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({
      guard: PrismaTenancyGuardService.create(),
      logger: createLogger("automation-test"),
    }).connect(PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }))
  : null;

function database(): PrismaClient {
  if (connection === null) throw new Error("LANGWATCH_TEST_DATABASE_URL is required here");
  return connection.client;
}

const refusingCipher = {
  encrypt: () => {
    throw new Error("unused");
  },
  decrypt: () => {
    throw new Error("unused");
  },
};

describe.skipIf(!databaseUrl)(
  "given triggers whose JSON columns an earlier release stored as text",
  () => {
    const namespace = `automation-json-text-${randomUUID()}`;
    const triggerId = (name: string) => `${namespace}-${name}`;
    let organizationId = "";
    let projectId = "";

    /** Writes a trigger with each column as the jsonb literal given, as an earlier release did. */
    const seed = async (name: string, columns: { filters: string; actionParams: string }) => {
      await database().$executeRaw`
      INSERT INTO "Trigger" ("id", "projectId", "name", "action", "actionParams", "filters",
        "lastRunAt", "createdAt", "updatedAt")
      VALUES (${triggerId(name)}, ${projectId}, ${name}, 'SEND_EMAIL',
        ${columns.actionParams}::jsonb, ${columns.filters}::jsonb, 0,
        '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')
    `;
    };

    const stored = async (name: string) => {
      const [row] = await database().$queryRaw<
        { filters: unknown; actionParams: unknown; updatedAt: Date }[]
      >`
      SELECT "filters", "actionParams", "updatedAt" FROM "Trigger"
      WHERE "id" = ${triggerId(name)} AND "projectId" = ${projectId}
    `;
      return row;
    };

    const triggers = () =>
      PrismaTriggerRepository.create(database(), frozenAt(nowInstant()), refusingCipher);

    beforeAll(async () => {
      const organization = await database().organization.create({
        data: { name: namespace, slug: namespace },
      });
      organizationId = organization.id;
      const team = await database().team.create({
        data: { name: namespace, slug: namespace, organizationId: organization.id },
      });
      const project = await database().project.create({
        data: {
          name: namespace,
          slug: namespace,
          apiKey: namespace,
          teamId: team.id,
          language: "typescript",
          framework: "other",
        },
        select: { id: true },
      });
      projectId = project.id;
      await seed("both-text", {
        filters: JSON.stringify(JSON.stringify({ topics: ["a"] })),
        actionParams: JSON.stringify(JSON.stringify({ members: ["ada@example.com"], big: 1 })),
      });
      await seed("precise", {
        filters: "{}",
        actionParams: JSON.stringify('{"threshold":12345678901234567890.5}'),
      });
      await seed("not-object", { filters: JSON.stringify("[1,2]"), actionParams: '"oops"' });
      await seed("objects", { filters: '{"a":["b"]}', actionParams: '{"k":1}' });
    });

    afterAll(async () => {
      await cleanupTestRows(database(), [
        ["trigger", { projectId }],
        ["project", { id: projectId }],
        ["team", { organizationId }],
        ["organization", { id: organizationId }],
      ]);
    });

    /** @scenario "The JSON-text step unwraps text that encodes a JSON object" */
    it("finds the text columns and unwraps the object ones, leaving the rest", async () => {
      const page = (await triggers().findJsonTextPage({ limit: 1000 })).filter((row) =>
        row.id.startsWith(namespace),
      );
      expect(page.map((row) => row.id)).toEqual(
        ["both-text", "not-object", "precise"].map(triggerId),
      );

      const report = await TriggerJsonTextUnwrapService.create({ triggers: triggers() }).unwrap({
        from: { after: `${namespace}-`, unwrapped: 0, leftAlone: 0, changed: 0, unparseable: 0 },
        dryRun: false,
      });

      expect(report).toEqual({ unwrapped: 3, leftAlone: 2, changed: 0, unparseable: 0 });
      expect(await stored("both-text")).toMatchObject({
        filters: { topics: ["a"] },
        actionParams: { members: ["ada@example.com"], big: 1 },
        updatedAt: new Date("2026-01-01T00:00:00Z"),
      });
      const [precise] = await database().$queryRaw<{ threshold: string }[]>`
      SELECT "actionParams"->>'threshold' AS "threshold" FROM "Trigger"
      WHERE "id" = ${triggerId("precise")} AND "projectId" = ${projectId}
    `;
      expect(precise?.threshold).toBe("12345678901234567890.5");
      expect(await stored("not-object")).toMatchObject({ filters: "[1,2]", actionParams: "oops" });
      expect(await stored("objects")).toMatchObject({
        filters: { a: ["b"] },
        actionParams: { k: 1 },
      });
    });

    /** @scenario "The JSON-text step leaves a row another writer changed" */
    it("unwraps nothing when the column no longer holds the text it read", async () => {
      await seed("raced", { filters: JSON.stringify("{}"), actionParams: "{}" });

      const outcome = await triggers().unwrapJsonText({
        triggerId: triggerId("raced"),
        projectId,
        column: "filters",
        text: '{"other":1}',
      });

      expect(outcome).toBe("changed");
      expect(await stored("raced")).toMatchObject({ filters: "{}" });
    });

    /** @scenario "The JSON-text step leaves text the database cannot store as an object" */
    it("reports text Postgres refuses to parse as unparseable and leaves it", async () => {
      const text = String.raw`{"name":"a\u0000b"}`;
      await seed("nul", { filters: JSON.stringify(text), actionParams: "{}" });

      const outcome = await triggers().unwrapJsonText({
        triggerId: triggerId("nul"),
        projectId,
        column: "filters",
        text,
      });

      expect(outcome).toBe("unparseable");
      expect(await stored("nul")).toMatchObject({ filters: text });
    });
  },
);
