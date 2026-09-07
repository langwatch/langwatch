import { prismaTableCatalogue, type PrismaTableModel } from "./table-catalogue.ts";
import { parsePrismaDatamodelRelations } from "./datamodel.ts";
import type { PrismaClient } from "./generated/client.ts";

export type { PrismaTableModel } from "./table-catalogue.ts";

/** Claims physical tables on this installation's single Prisma datasource. */
export function prismaTables<
  const Models extends readonly [PrismaTableModel, ...PrismaTableModel[]],
>(...models: Models) {
  if (models.length === 0) {
    throw new Error("A Prisma repository must declare at least one model.");
  }

  const tables = models.map((model) => {
    if (!Object.hasOwn(prismaTableCatalogue, model)) {
      throw new Error(`Unknown Prisma model ${String(model)} in repository ownership claim.`);
    }
    return prismaTableCatalogue[model];
  });

  return Object.freeze({ store: "prisma", tables: Object.freeze(tables) });
}

type PrismaDelegateKey<Model extends PrismaTableModel> = Uncapitalize<Model> & keyof PrismaClient;

/** Only delegates for declared models, plus a transaction that preserves this scope. */
export type ScopedPrismaClient<Models extends readonly PrismaTableModel[]> = Readonly<
  Pick<PrismaClient, PrismaDelegateKey<Models[number]>> & {
    transaction<Result>(
      callback: (client: ScopedPrismaClient<Models>) => Promise<Result>,
    ): Promise<Result>;
  }
>;

export interface PrismaRelationException {
  readonly model: PrismaTableModel;
  readonly relation: string;
  readonly operation: string;
  readonly reason: string;
  readonly removalCondition: string;
}

type RelationIndex = ReadonlyMap<string, ReadonlyMap<string, PrismaTableModel>>;

function relationIndex(): RelationIndex {
  const fields = new Map<string, Map<string, PrismaTableModel>>();
  for (const relation of parsePrismaDatamodelRelations()) {
    const modelRelations = fields.get(relation.model) ?? new Map<string, PrismaTableModel>();
    modelRelations.set(relation.field, relation.target as PrismaTableModel);
    fields.set(relation.model, modelRelations);
  }
  return fields;
}

const relations = relationIndex();

function ownershipError(message: string): Error {
  return new Error(`Prisma repository capability denied ${message}. Use the owning FeatureApi instead.`);
}

function assertRelationAccess(
  value: unknown,
  model: PrismaTableModel,
  operation: string,
  claimedModels: ReadonlySet<PrismaTableModel>,
  exceptions: readonly PrismaRelationException[],
): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) {
      assertRelationAccess(item, model, operation, claimedModels, exceptions);
    }
    return;
  }

  const modelRelations = relations.get(model);
  for (const [key, child] of Object.entries(value)) {
    const target = modelRelations?.get(key);
    if (target) {
      const exception = exceptions.find(
        (candidate) =>
          candidate.model === model &&
          candidate.relation === key &&
          candidate.operation === operation,
      );
      if (!claimedModels.has(target) && !exception) {
        throw ownershipError(`${operation} of foreign relation ${model}.${key}`);
      }
      assertRelationAccess(child, target, operation, claimedModels, exceptions);
      continue;
    }
    assertRelationAccess(child, model, operation, claimedModels, exceptions);
  }
}

function delegateName(model: PrismaTableModel): string {
  return `${model.slice(0, 1).toLowerCase()}${model.slice(1)}`;
}

function scopedClient<Models extends readonly PrismaTableModel[]>(
  client: PrismaClient,
  models: Models,
  exceptions: readonly PrismaRelationException[],
): ScopedPrismaClient<Models> {
  const claimedModels = new Set<PrismaTableModel>(models);
  const claimedDelegates = new Map(models.map((model) => [delegateName(model), model]));
  const allDelegates = new Set(
    Object.keys(prismaTableCatalogue).map((model) => delegateName(model as PrismaTableModel)),
  );
  const source = client as unknown as Record<string, unknown>;

  return new Proxy(
    {},
    {
      get(_target, property) {
        if (typeof property !== "string") return undefined;
        if (property === "transaction") {
          return async <Result>(callback: (transaction: ScopedPrismaClient<Models>) => Promise<Result>) => {
            const transaction = source.$transaction;
            if (typeof transaction !== "function") {
              throw ownershipError("transaction because the underlying client has no transaction function");
            }
            return Reflect.apply(transaction, client, [
              (transactionClient: PrismaClient) => callback(scopedClient(transactionClient, models, exceptions)),
            ]) as Promise<Result>;
          };
        }
        const model = claimedDelegates.get(property);
        if (!model) {
          if (property.startsWith("$") || allDelegates.has(property)) {
            throw ownershipError(`access to client member ${property}`);
          }
          return undefined;
        }
        const delegate = source[property];
        if (!delegate || typeof delegate !== "object") {
          throw ownershipError(`delegate ${property} is unavailable`);
        }
        return new Proxy(delegate, {
          get(delegateTarget, operation) {
            const method = Reflect.get(delegateTarget, operation);
            if (typeof method !== "function") return method;
            return (...args: unknown[]) => {
              assertRelationAccess(args[0], model, String(operation), claimedModels, exceptions);
              return Reflect.apply(method, delegateTarget, args);
            };
          },
        });
      },
    },
  ) as ScopedPrismaClient<Models>;
}

/**
 * Restricts a repository to model delegates it has declared. This is a
 * rollout capability: it does not claim process-wide Prisma isolation until
 * every repository is registered and receives one.
 */
export function scopedPrismaClient<const Models extends readonly PrismaTableModel[]>(
  client: PrismaClient,
  models: Models,
  options: Readonly<{ relationExceptions?: readonly PrismaRelationException[] }> = {},
): ScopedPrismaClient<Models> {
  if (models.length === 0) {
    throw new Error("A Prisma repository capability must declare at least one model.");
  }
  for (const model of models) {
    if (!Object.hasOwn(prismaTableCatalogue, model)) {
      throw new Error(`Unknown Prisma model ${String(model)} in repository capability.`);
    }
  }
  const exceptions = options.relationExceptions ?? [];
  return scopedClient(client, models, exceptions);
}
