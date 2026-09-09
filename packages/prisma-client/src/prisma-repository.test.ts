import { describe, expect, it } from "vitest";
import { PrismaRepository, prismaRepositories } from "./prisma-repository.ts";
import type { PrismaClient } from "./generated/client.ts";

class AnnotationRepository extends PrismaRepository.for("Annotation") {
  static readonly create = this.factory((prisma) => new AnnotationRepository(prisma));

  readClient() {
    return this.prisma;
  }
}

class QueueRepository extends PrismaRepository.transactionalFor("AnnotationQueue") {
  static readonly create = this.factory((prisma) => new QueueRepository(prisma));

  async inTransaction() {
    return this.transaction(async (transaction) => transaction.annotationQueue);
  }
}

class ReplacementAnnotationRepository extends PrismaRepository.for("Annotation") {
  static readonly create = this.factory((prisma) => new ReplacementAnnotationRepository(prisma));
}

describe("PrismaRepository", () => {
  it("declares canonical table claims and narrows the client passed to a factory", () => {
    const prisma = {} as PrismaClient;
    const repository = AnnotationRepository.create({ prisma });

    expect(AnnotationRepository.tables).toEqual({ store: "prisma", tables: ["Annotation"] });
    expect(repository.readClient()).toBe(prisma);
  });

  it("builds repositories from one shared Prisma client and derives their claims", () => {
    const prisma = {} as PrismaClient;
    const provider = prismaRepositories({ annotations: AnnotationRepository, queues: QueueRepository });
    const repositories = provider.create({ prisma });

    expect(provider.requires).toEqual(["prisma"]);
    expect(provider.repositories).toEqual({
      annotations: { tables: { store: "prisma", tables: ["Annotation"] } },
      queues: { tables: { store: "prisma", tables: ["AnnotationQueue"] } },
    });
    expect(repositories.annotations.readClient()).toBe(prisma);
  });

  it("captures factories and claims when the provider is declared", () => {
    const prisma = {} as PrismaClient;
    const definitions: {
      annotations: typeof AnnotationRepository | typeof ReplacementAnnotationRepository;
    } = { annotations: AnnotationRepository };
    const provider = prismaRepositories(definitions);

    definitions.annotations = ReplacementAnnotationRepository;
    const repositories = provider.create({ prisma });

    expect(provider.repositories).toEqual({
      annotations: { tables: { store: "prisma", tables: ["Annotation"] } },
    });
    expect(repositories.annotations).toBeInstanceOf(AnnotationRepository);
  });
});
