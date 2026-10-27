import type { Prisma, PrismaClient } from "@langwatch/prisma-client/generated";
import { describe, expect, it, vi } from "vitest";

import { prismaDouble } from "../prisma.double.ts";

const project = { id: "project-1", name: "Project" };

describe("given a Prisma double", () => {
  describe("when the code calls a scripted delegate method", () => {
    /** @scenario "A scripted member answers what the test scripted" */
    it("answers the scripted row and records the call", async () => {
      const findUnique = vi.fn(async () => project);
      const prisma = prismaDouble({ project: { findUnique } });

      await expect(prisma.project.findUnique({ where: { id: "project-1" } })).resolves.toBe(
        project,
      );
      expect(findUnique).toHaveBeenCalledWith({ where: { id: "project-1" } });
    });
  });

  describe("when the code calls a method nobody scripted", () => {
    /** @scenario "An unscripted method throws naming its path" */
    it("throws naming the delegate method", () => {
      const prisma = prismaDouble({ project: { findUnique: async () => project } });

      expect(() => prisma.project.findMany()).toThrow("prisma.project.findMany is not scripted");
      expect(() => prisma.$transaction([])).toThrow("prisma.$transaction is not scripted");
    });
  });

  describe("when the code calls into a delegate nobody scripted", () => {
    /** @scenario "An unscripted namespace throws at the member the code calls" */
    it("throws naming the full path", () => {
      const prisma = prismaDouble({ project: {} });

      expect(() => prisma.team.findFirst()).toThrow("prisma.team.findFirst is not scripted");
    });
  });

  describe("when it is handed to code that wants the client", () => {
    /** @scenario "A client double typechecks as the real client" */
    it("is a PrismaClient, a transaction client and a delegate pick without a cast", () => {
      const prisma: PrismaClient = prismaDouble();
      const transaction: Prisma.TransactionClient = prisma;
      const projects: Pick<PrismaClient, "project"> = prisma;

      expect(transaction).toBe(prisma);
      expect(projects).toBe(prisma);
    });
  });
});
