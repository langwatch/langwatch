import type { PrismaQueryContext, PrismaQueryExecutor } from "./connection.ts";
import type { PrismaClient } from "./generated/client.ts";
import { guardProjectId } from "./multi-tenancy-guard.ts";
import { ORG_SCOPED_MODEL_NAMES, type PRISMA_READ_ACTIONS } from "./organization-guard.ts";
import type { PrismaModelClient, PrismaTableModel } from "./ownership.ts";

/**
 * A declared operator read (ARCHITECTURE §7): one module may read one guarded
 * model across organizations, with only the actions it names. Writes, other
 * models and raw SQL are refused on the client built from it.
 */
export type OperatorReadAction = (typeof PRISMA_READ_ACTIONS)[number];

export type OperatorReadHandle<Model extends PrismaTableModel = PrismaTableModel> = Readonly<{
  model: Model;
  actions: readonly OperatorReadAction[];
}>;

/** Handles minted by `OperatorRead.of`; a hand-built lookalike is never one. */
const MINTED = new WeakSet<object>();

function isOperatorReadHandle(value: unknown): value is OperatorReadHandle {
  return typeof value === "object" && value !== null && MINTED.has(value);
}

export const OperatorRead = {
  of<const Model extends PrismaTableModel>(
    model: Model,
    { actions }: { actions: readonly [OperatorReadAction, ...OperatorReadAction[]] },
  ): OperatorReadHandle<Model> {
    if (!ORG_SCOPED_MODEL_NAMES.includes(model)) throw new UnguardedOperatorReadError({ model });
    const handle = Object.freeze({ model, actions: Object.freeze([...actions]) });
    MINTED.add(handle);
    return handle;
  },
};

/** The one line each operator read writes: who read, which model, which action. */
export interface OperatorReadLog {
  info(fields: Readonly<{ module: string; model: string; action: string }>, message: string): void;
}

export class UnguardedOperatorReadError extends Error {
  readonly code = "operator_read_unguarded_model";

  constructor({ model }: { model: string }) {
    super(`An operator read names ${model}, which the organization guard does not guard`);
    this.name = "UnguardedOperatorReadError";
  }
}

export class OperatorReadRefusedError extends Error {
  readonly code = "operator_read_refused";

  constructor({ owner, model, action }: { owner: string; model: string; action: string }) {
    super(
      `Operator read by "${owner}" refused: ${action} on ${model} is not what its handle declared`,
    );
    this.name = "OperatorReadRefusedError";
  }
}

/** Admits exactly one handle's model and actions, logging each read; refuses the rest. */
export class OperatorReadGuard {
  readonly #actions: ReadonlySet<string>;

  private constructor(
    private readonly owner: string,
    private readonly handle: OperatorReadHandle,
    private readonly logger: OperatorReadLog,
  ) {
    this.#actions = new Set<string>(handle.actions);
  }

  static create({
    owner,
    handle,
    logger,
  }: {
    owner: string;
    handle: OperatorReadHandle;
    logger: OperatorReadLog;
  }): OperatorReadGuard {
    return new OperatorReadGuard(owner, handle, logger);
  }

  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    const { model, action, args } = context;
    if (model !== this.handle.model || !this.#actions.has(action)) {
      throw new OperatorReadRefusedError({ owner: this.owner, model: model ?? "raw SQL", action });
    }
    this.logger.info({ module: this.owner, model, action }, "operator read");
    return guardProjectId({ model, action, args }, (guarded) => next(guarded.args));
  }
}

/** Builds one handle's client over the raw connection; only the stores owner holds one. */
export type OperatorReadMint = (input: {
  owner: string;
  handle: OperatorReadHandle;
}) => PrismaClient;

export class UndeclaredOperatorReadError extends Error {
  readonly code = "operator_read_undeclared";

  constructor({ owner, model }: { owner: string; model: string }) {
    super(`"${owner}" resolved an operator read of ${model} it did not declare`);
    this.name = "UndeclaredOperatorReadError";
  }
}

export class ForgedOperatorReadError extends Error {
  readonly code = "operator_read_forged";

  constructor({ owner }: { owner: string }) {
    super(`"${owner}" declared an operator read not made by OperatorRead.of`);
    this.name = "ForgedOperatorReadError";
  }
}

export class SealedOperatorReadsError extends Error {
  readonly code = "operator_reads_sealed";

  constructor({ owner, model }: { owner: string; model: string }) {
    super(`"${owner}" resolved an operator read of ${model} after boot; resolve it in create()`);
    this.name = "SealedOperatorReadsError";
  }
}

export class UnavailableOperatorReadError extends Error {
  readonly code = "operator_read_unavailable";

  constructor({ owner, model }: { owner: string; model: string }) {
    super(`"${owner}" resolved an operator read of ${model}, and this process opened no Postgres`);
    this.name = "UnavailableOperatorReadError";
  }
}

/** Scopes the mint per module and seals when boot finishes, as the secrets resolver does. */
export class OperatorReadsResolver {
  #sealed = false;

  private constructor(private readonly mint: OperatorReadMint | undefined) {}

  static over({ mint }: { mint?: OperatorReadMint | undefined }): OperatorReadsResolver {
    return new OperatorReadsResolver(mint);
  }

  /** The capability one module's create() receives: its own handles, nothing else. */
  scopeTo({
    owner,
    declared,
  }: {
    owner: string;
    declared: readonly unknown[];
  }): ScopedOperatorReads {
    const handles = new Set<OperatorReadHandle>(declared.filter(isOperatorReadHandle));
    if (handles.size !== declared.length) throw new ForgedOperatorReadError({ owner });
    return new ScopedOperatorReads(({ handle }) => {
      const model = handle.model;
      if (this.#sealed) throw new SealedOperatorReadsError({ owner, model });
      if (!handles.has(handle)) throw new UndeclaredOperatorReadError({ owner, model });
      if (!this.mint) throw new UnavailableOperatorReadError({ owner, model });
      return this.mint({ owner, handle });
    });
  }

  seal(): void {
    this.#sealed = true;
  }
}

/** There is no `get()` returning a client to keep — only `into`. */
export class ScopedOperatorReads {
  constructor(private readonly resolve: (input: { handle: OperatorReadHandle }) => PrismaClient) {}

  into<Model extends PrismaTableModel, Out>(
    handle: OperatorReadHandle<Model>,
    build: (client: PrismaModelClient<Model>) => Out,
  ): Out {
    return build(this.resolve({ handle }));
  }
}
