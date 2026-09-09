import type { Prisma, PrismaClient } from "./generated/client.ts";
import {
  prismaTables,
  type PrismaModelClient,
  type PrismaTableModel,
  type PrismaTables,
} from "./ownership.ts";

/** The native Prisma delegates declared by one repository. */
export type PrismaRepositoryClient<Models extends readonly PrismaTableModel[]> = Readonly<
  PrismaModelClient<Models[number]>
>;

/** The native Prisma delegates available inside an interactive transaction. */
export type PrismaRepositoryTransactionClient<Models extends readonly PrismaTableModel[]> =
  Readonly<Pick<Prisma.TransactionClient, Uncapitalize<Models[number]>>>;

type PrismaRepositoryTransactionDatabase<Models extends readonly PrismaTableModel[]> =
  PrismaRepositoryClient<Models> & Pick<PrismaClient, "$transaction">;

export type PrismaRepositoryFactoryInput<Database> = Readonly<{
  readonly prisma: Database;
}>;

type PrismaRepositoryFactory<Database, Repository> = (
  input: PrismaRepositoryFactoryInput<Database>,
) => Repository;

export interface PrismaRepositoryDefinition<
  Models extends readonly PrismaTableModel[] = readonly PrismaTableModel[],
  Database extends PrismaRepositoryClient<Models> = PrismaClient,
  Repository = unknown,
> {
  readonly tables: PrismaTables<Models>;
  readonly create: PrismaRepositoryFactory<Database, Repository>;
}

type PrismaRepositoryBase<
  Models extends readonly PrismaTableModel[],
  Database extends PrismaRepositoryClient<Models>,
  Instance extends PrismaRepository<Models> = PrismaRepository<Models>,
> =
  (abstract new (prisma: Database) => Instance) & {
    readonly tables: PrismaTables<Models>;
    readonly factory: <Repository>(
      factory: (prisma: Database) => Repository,
    ) => PrismaRepositoryFactory<Database, Repository>;
  };

/**
 * Base class for a Prisma repository that owns a declared set of model delegates.
 * It narrows the static type only; it does not isolate Prisma access at runtime.
 */
export abstract class PrismaRepository<Models extends readonly PrismaTableModel[]> {
  #prisma: PrismaRepositoryClient<Models>;

  protected constructor(prisma: PrismaRepositoryClient<Models>) {
    this.#prisma = prisma;
  }

  protected get prisma(): PrismaRepositoryClient<Models> {
    return this.#prisma;
  }

  static for<const Models extends readonly [PrismaTableModel, ...PrismaTableModel[]]>(
    ...models: Models
  ): PrismaRepositoryBase<Models, PrismaRepositoryClient<Models>> {
    class DeclaredPrismaRepository extends PrismaRepository<Models> {
      static readonly tables = prismaTables(...models);
    }

    return DeclaredPrismaRepository as typeof DeclaredPrismaRepository &
      PrismaRepositoryBase<Models, PrismaRepositoryClient<Models>>;
  }

  static factory<
    Models extends readonly PrismaTableModel[],
    Database extends PrismaRepositoryClient<Models>,
    Repository,
  >(
    this: PrismaRepositoryBase<Models, Database>,
    factory: (prisma: Database) => Repository,
  ): PrismaRepositoryFactory<Database, Repository> {
    return ({ prisma }) => factory(prisma);
  }

  static transactionalFor<const Models extends readonly [PrismaTableModel, ...PrismaTableModel[]]>(
    ...models: Models
  ): PrismaRepositoryBase<
    Models,
    PrismaRepositoryTransactionDatabase<Models>,
    TransactionalPrismaRepository<Models>
  > {
    class DeclaredTransactionalPrismaRepository extends TransactionalPrismaRepository<Models> {
      static readonly tables = prismaTables(...models);
    }

    return DeclaredTransactionalPrismaRepository as typeof DeclaredTransactionalPrismaRepository &
      PrismaRepositoryBase<
        Models,
        PrismaRepositoryTransactionDatabase<Models>,
        TransactionalPrismaRepository<Models>
      >;
  }
}

export abstract class TransactionalPrismaRepository<
  Models extends readonly PrismaTableModel[],
> extends PrismaRepository<Models> {
  #transactionClient: Pick<PrismaClient, "$transaction">;

  protected constructor(prisma: PrismaRepositoryTransactionDatabase<Models>) {
    super(prisma);
    this.#transactionClient = prisma;
  }

  protected transaction<Result>(
    callback: (transaction: PrismaRepositoryTransactionClient<Models>) => Promise<Result>,
  ): Promise<Result> {
    return this.#transactionClient.$transaction(callback);
  }
}

type RepositoryInstances<Definitions extends Record<string, PrismaRepositoryDefinition>> = {
  readonly [Name in keyof Definitions]: ReturnType<Definitions[Name]["create"]>;
};

type RepositoryClaims<Definitions extends Record<string, PrismaRepositoryDefinition>> = {
  readonly [Name in keyof Definitions]: Readonly<{ readonly tables: Definitions[Name]["tables"] }>;
};

/** Creates the single Prisma-backed repository provider for a feature. */
export function prismaRepositories<const Definitions extends Record<string, PrismaRepositoryDefinition>>(
  definitions: Definitions,
): Readonly<{
  readonly requires: readonly ["prisma"];
  readonly repositories: RepositoryClaims<Definitions>;
  readonly create: (input: Readonly<{ readonly prisma: PrismaClient }>) => RepositoryInstances<Definitions>;
}> {
  const entries = Object.freeze(
    Object.entries(definitions).map(([name, repository]) =>
      Object.freeze({
        create: repository.create,
        name,
        tables: Object.freeze({
          store: repository.tables.store,
          tables: Object.freeze([...repository.tables.tables]),
        }),
      }),
    ),
  );
  const repositories = Object.fromEntries(
    entries.map((entry) => [entry.name, { tables: entry.tables }]),
  ) as RepositoryClaims<Definitions>;

  return Object.freeze({
    requires: ["prisma"] as const,
    repositories: Object.freeze(repositories),
    create: ({ prisma }) => {
      const instances = Object.fromEntries(
        entries.map((entry) => [entry.name, entry.create({ prisma })]),
      ) as RepositoryInstances<Definitions>;
      return Object.freeze(instances);
    },
  });
}
