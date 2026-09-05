/**
 * The per-project BYOC S3 lookup: a project's organization decides which
 * bucket its bytes land in, so a project under an organization that brought
 * its own account must never resolve to the shared one.
 */
import { parseDataplaneS3RoutingTable } from "@langwatch/config";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { describe, expect, it, vi } from "vitest";

import { TasksProjectS3SourcePort } from "../tasks-stored-object-storage.adapter";

const ACME = {
  endpoint: "https://s3.eu-central-1.amazonaws.com",
  bucket: "langwatch-storage-acme",
  accessKeyId: "AKIAEXAMPLE",
  secretAccessKey: "secret123",
};

const routesFor = (source: Record<string, string>) => parseDataplaneS3RoutingTable(source).routes;

/** Only `project.findUnique` is reached, so only that is stood up. */
const prismaFor = (organizationId: string | null) => ({
  project: {
    findUnique: vi.fn(async () => (organizationId === null ? null : { team: { organizationId } })),
  },
});

const asPrisma = (fake: ReturnType<typeof prismaFor>) =>
  fake as unknown as Pick<PrismaClient, "project">;

describe("given a deployment routing one organization to its own S3 account", () => {
  const routes = routesFor({ DATAPLANE_S3__acme__org123: JSON.stringify(ACME) });

  describe("when a project under that organization resolves its storage", () => {
    /** @scenario Project in a private-S3 org routes to the private bucket */
    it("resolves to the private bucket, with that account's own credentials", async () => {
      const port = new TasksProjectS3SourcePort(() => asPrisma(prismaFor("org123")), routes);

      await expect(port.tryGet("project-abc")).resolves.toEqual({
        bucket: "langwatch-storage-acme",
        endpoint: "https://s3.eu-central-1.amazonaws.com",
        credentials: { accessKeyId: "AKIAEXAMPLE", secretAccessKey: "secret123" },
      });
    });
  });

  describe("when a project under another organization resolves its storage", () => {
    it("resolves to nothing, which is how the shared bucket stays the default", async () => {
      const port = new TasksProjectS3SourcePort(() => asPrisma(prismaFor("org456")), routes);

      await expect(port.tryGet("project-xyz")).resolves.toBeNull();
    });
  });

  describe("when the project does not exist", () => {
    it("resolves to nothing rather than guessing an organization", async () => {
      const port = new TasksProjectS3SourcePort(() => asPrisma(prismaFor(null)), routes);

      await expect(port.tryGet("project-missing")).resolves.toBeNull();
    });
  });
});

describe("given a deployment routing nobody", () => {
  describe("when any project resolves its storage", () => {
    it("never asks the database, because no answer could change the destination", async () => {
      const prisma = prismaFor("org123");
      const port = new TasksProjectS3SourcePort(() => asPrisma(prisma), routesFor({}));

      await expect(port.tryGet("project-abc")).resolves.toBeNull();
      expect(prisma.project.findUnique).not.toHaveBeenCalled();
    });
  });
});
