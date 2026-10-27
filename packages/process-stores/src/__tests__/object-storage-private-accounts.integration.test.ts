/**
 * @vitest-environment node
 * The DATAPLANE_S3__ family end to end: the stores open over it, the tenant directory reads the
 * project's organisation off Postgres, and the object lands in that organisation's own S3 while
 * Azure is the shared backend. Requires LANGWATCH_TEST_DATABASE_URL.
 */
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";

import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaConnection,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { createTestLogger } from "@langwatch/test-harness";
import { cleanupTestRows } from "@langwatch/test-harness/prisma";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  completeAzure,
  noObjectStorage,
  openObjectStorage,
} from "./object-storage-stores.fixture.ts";

/** Seeding writes an organisation, team and project outside any request scope. */
class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;
const suffix = randomUUID().slice(0, 12);
const organizationId = `org_s3_${suffix}`;
const teamId = `team_s3_${suffix}`;
const projectId = `project_s3_${suffix}`;

/** What each bucket holds, keyed `bucket/key`: a scripted S3 over HTTP the real client reaches. */
const held = new Map<string, Buffer>();
let server: Server;
let endpoint: string;

async function* body(text: string): AsyncGenerator<Uint8Array> {
  yield new TextEncoder().encode(text);
}

async function textOf(stream: AsyncIterable<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  for await (const chunk of stream) text += decoder.decode(chunk, { stream: true });
  return text + decoder.decode();
}

describe.skipIf(!DB_URL)("given a DATAPLANE_S3__ entry for an organisation on Postgres", () => {
  let connection: PrismaConnection | undefined;
  let prisma: PrismaClient | undefined;

  beforeAll(async () => {
    server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        const slot = decodeURIComponent((request.url ?? "").split("?")[0]!.slice(1));
        if (request.method === "PUT") {
          held.set(slot, Buffer.concat(chunks));
          response.statusCode = 200;
          response.end();
          return;
        }
        const stored = held.get(slot);
        response.statusCode = stored ? 200 : 404;
        response.end(request.method === "GET" ? stored : undefined);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("No port was bound.");
    endpoint = `http://127.0.0.1:${address.port}`;

    connection = PrismaConnectionService.create({
      guard: new AllowTestQueries(),
      logger: createTestLogger().logger,
    }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
    prisma = connection.client as PrismaClient;
    await prisma.organization.create({
      data: { id: organizationId, name: organizationId, slug: `--${organizationId}` },
    });
    await prisma.team.create({
      data: { id: teamId, name: teamId, slug: `--${teamId}`, organizationId },
    });
    await prisma.project.create({
      data: {
        id: projectId,
        teamId,
        name: projectId,
        slug: projectId,
        apiKey: projectId,
        language: "typescript",
        framework: "test",
      },
    });
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    if (!prisma) return;
    await cleanupTestRows(prisma, [
      ["project", { id: projectId }],
      ["team", { id: teamId }],
      ["organization", { id: organizationId }],
    ]);
    await prisma.$disconnect();
  });

  describe("when Azure is the shared backend and the project writes and reads an object", () => {
    /** @scenario "Project in a private-S3 org routes to the private bucket" */
    it("keeps the object in the organisation's own bucket, never building the Azure backend", async () => {
      const opened = await openObjectStorage({
        settings: {
          ...noObjectStorage,
          backend: "azure",
          azure: { ...completeAzure, authMode: "sharedKey" },
        },
        environment: {
          DATABASE_URL: DB_URL ?? "",
          [`DATAPLANE_S3__acme__${organizationId}`]: JSON.stringify({
            endpoint,
            bucket: "acme-dataplane",
            accessKeyId: "content-marker",
            secretAccessKey: "content-marker",
          }),
        },
      });

      try {
        const at = { projectId, key: `${projectId}/object-1` };
        await opened.storage.write(at, body("payload"), {
          byteLength: 7,
          contentType: "text/plain",
        });

        expect(await textOf(await opened.storage.read(at))).toBe("payload");
        expect([...held.keys()]).toEqual([`acme-dataplane/${projectId}/object-1`]);
        await expect(opened.storage.destination(projectId)).resolves.toEqual({
          kind: "s3",
          bucket: "acme-dataplane",
        });
      } finally {
        await opened.close();
      }
    });
  });
});
