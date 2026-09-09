import {
  prismaModelFieldCatalogue,
  prismaRelationCatalogue,
  prismaTableCatalogue,
  type PrismaTableModel,
} from "./table-catalogue.ts";
import type { PrismaClient } from "./generated/client.ts";

export type { PrismaTableModel } from "./table-catalogue.ts";

export type PrismaTables<Models extends readonly PrismaTableModel[]> = Readonly<{
  readonly store: "prisma";
  readonly tables: Readonly<{
    [Index in keyof Models]: Models[Index] extends PrismaTableModel
      ? (typeof prismaTableCatalogue)[Models[Index]]
      : never;
  }>;
}>;

/** Claims physical tables on this installation's single Prisma datasource. */
export function prismaTables<
  const Models extends readonly [PrismaTableModel, ...PrismaTableModel[]],
>(...models: Models): PrismaTables<Models> {
  if (models.length === 0) {
    throw new Error("A Prisma repository must declare at least one model.");
  }

  const tables = models.map((model) => {
    if (!Object.hasOwn(prismaTableCatalogue, model)) {
      throw new Error(`Unknown Prisma model ${String(model)} in repository ownership claim.`);
    }
    return prismaTableCatalogue[model];
  });

  return Object.freeze({ store: "prisma", tables: Object.freeze(tables) }) as PrismaTables<Models>;
}

type PrismaDelegateKey<Model extends PrismaTableModel> = Uncapitalize<Model> & keyof PrismaClient;

/** Native model delegates, preserving Prisma's select/include inference. */
export type PrismaModelClient<Model extends PrismaTableModel> = Readonly<
  Pick<PrismaClient, PrismaDelegateKey<Model>>
>;

type ScopedPrismaDelegate<Delegate> = {
  readonly [Method in keyof Delegate]: Delegate[Method] extends (
    ...arguments_: infer Arguments
  ) => infer Result
    ? (...arguments_: Arguments) => Promise<Awaited<Result>>
    : never;
};

/** Only delegates for declared models, plus a transaction that preserves this scope. */
export type ScopedPrismaClient<Models extends readonly PrismaTableModel[]> = Readonly<
  {
    [Key in PrismaDelegateKey<Models[number]>]: ScopedPrismaDelegate<PrismaClient[Key]>;
  } & {
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
type FieldIndex = ReadonlyMap<string, ReadonlySet<string>>;

function isPrismaTableModel(value: string): value is PrismaTableModel {
  return Object.hasOwn(prismaTableCatalogue, value);
}

function relationIndex(): RelationIndex {
  const fields = new Map<string, Map<string, PrismaTableModel>>();
  for (const [model, modelRelations] of Object.entries(prismaRelationCatalogue)) {
    const relations = new Map<string, PrismaTableModel>();
    for (const [field, target] of Object.entries(modelRelations)) {
      if (!isPrismaTableModel(target)) {
        throw new Error(`Unknown Prisma relation target ${target} for ${model}.${field}.`);
      }
      relations.set(field, target);
    }
    fields.set(model, relations);
  }
  return fields;
}

function fieldIndex(): FieldIndex {
  return new Map(
    Object.entries(prismaModelFieldCatalogue).map(([model, fields]) => [model, new Set(fields)]),
  );
}

const relations = relationIndex();
const fields = fieldIndex();
const UNSAFE_MUTATION_OPERATIONS = new Set([
  "delete",
  "deleteMany",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "upsert",
]);
const RELATION_READ_OPERATIONS = new Set([
  "aggregate",
  "count",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "findUnique",
  "findUniqueOrThrow",
  "groupBy",
]);

function ownershipError(message: string): Error {
  return new Error(
    `Prisma repository capability denied ${message}. Use the owning FeatureApi instead.`,
  );
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
  const modelFields = fields.get(model);
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
    if (modelFields?.has(key)) continue;
    assertRelationAccess(child, model, operation, claimedModels, exceptions);
  }
}

function delegateName(model: PrismaTableModel): string {
  return `${model.slice(0, 1).toLowerCase()}${model.slice(1)}`;
}

function scopedClient<Models extends readonly PrismaTableModel[]>(
  client: object,
  models: readonly PrismaTableModel[],
  exceptions: readonly PrismaRelationException[],
  transaction:
    | (<Result>(callback: (transactionClient: object) => Promise<Result>) => Promise<Result>)
    | undefined,
): ScopedPrismaClient<Models> {
  const claimedModels = new Set<PrismaTableModel>(models);
  const claimedDelegates = new Map(models.map((model) => [delegateName(model), model]));
  const allDelegates = new Set(
    Object.keys(prismaTableCatalogue).map((model) => delegateName(model as PrismaTableModel)),
  );
  return new Proxy(
    {},
    {
      get(_target, property) {
        if (typeof property !== "string") return undefined;
        if (property === "transaction") {
          return async <Result>(
            callback: (transaction: ScopedPrismaClient<Models>) => Promise<Result>,
          ) => {
            if (!transaction) {
              throw ownershipError(
                "transaction because the underlying client has no transaction function",
              );
            }
            return transaction((transactionClient) =>
              callback(scopedClient(transactionClient, models, exceptions, undefined)),
            );
          };
        }
        const model = claimedDelegates.get(property);
        if (!model) {
          if (property.startsWith("$") || allDelegates.has(property)) {
            throw ownershipError(`access to client member ${property}`);
          }
          return undefined;
        }
        const delegate = Reflect.get(client, property);
        if (!delegate || typeof delegate !== "object") {
          throw ownershipError(`delegate ${property} is unavailable`);
        }
        return new Proxy(delegate, {
          get(delegateTarget, operation) {
            const method = Reflect.get(delegateTarget, operation);
            if (typeof method !== "function") return method;
            return (...args: unknown[]) => {
              assertRelationAccess(args[0], model, String(operation), claimedModels, exceptions);
              if (UNSAFE_MUTATION_OPERATIONS.has(String(operation))) {
                throw ownershipError(
                  `${String(operation)} because Prisma relationMode cascades are not scoped`,
                );
              }
              const result = Reflect.apply(method, delegateTarget, args);
              return new Promise((resolve, reject) => {
                Promise.resolve(result).then(resolve, reject);
              });
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
  const exceptions = Object.freeze(
    (options.relationExceptions ?? []).map((exception) => {
      const target = relations.get(exception.model)?.get(exception.relation);
      if (
        !Object.hasOwn(prismaTableCatalogue, exception.model) ||
        !target ||
        typeof exception.relation !== "string" ||
        typeof exception.operation !== "string" ||
        typeof exception.reason !== "string" ||
        typeof exception.removalCondition !== "string" ||
        !exception.reason.trim() ||
        !exception.removalCondition.trim() ||
        !RELATION_READ_OPERATIONS.has(exception.operation)
      ) {
        throw new Error(
          "A Prisma relation exception must name a read relation, reason, and removal condition.",
        );
      }
      return Object.freeze({ ...exception });
    }),
  );
  return scopedClient(client, Object.freeze([...models]), exceptions, (callback) =>
    client.$transaction(callback),
  );
}
