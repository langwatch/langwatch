import type { AggregateType } from "./aggregateType";
import type { Event } from "./types";

/**
 * The set of aggregate types a pipeline owns, and — when the pipeline declares
 * them — which aggregate owns each event type (ADR-113).
 *
 * A pipeline built with `.withAggregateType(x)` has the scope `{ x }` with no
 * ownership map: that is today's contract, and every rule below degrades to
 * today's behaviour for it. A pipeline built with `.withAggregateTypes({...})`
 * carries the ownership map and, when it names more than one type, is
 * "multi-aggregate": commands must bind to a type, fold state is keyed by
 * type and id together, and projection kill-switches use the pipeline name.
 */
export interface AggregateScope {
  readonly types: readonly AggregateType[];
  /** Event type → owning aggregate. Absent on a `.withAggregateType(x)` pipeline. */
  readonly eventOwners?: Readonly<Record<string, AggregateType>>;
}

export class AggregateScopeError extends Error {
  constructor(
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "AggregateScopeError";
  }
}

export function singleAggregateScope(type: AggregateType): AggregateScope {
  return { types: [type] };
}

/** Accepts the bare type every pre-ADR-113 caller passes, or a scope. */
export function toAggregateScope(
  scope: AggregateType | AggregateScope,
): AggregateScope {
  return typeof scope === "string" ? singleAggregateScope(scope) : scope;
}

export type AggregateScopeDeclaration = Readonly<
  Partial<Record<AggregateType, readonly string[]>>
>;

export function declaredAggregateScope(
  declaration: AggregateScopeDeclaration,
): AggregateScope {
  const types = Object.keys(declaration) as AggregateType[];
  if (types.length === 0) {
    throw new AggregateScopeError(
      "A pipeline must declare at least one aggregate type",
    );
  }
  const eventOwners: Record<string, AggregateType> = {};
  for (const type of types) {
    for (const eventType of declaration[type] ?? []) {
      const existing = eventOwners[eventType];
      if (existing !== undefined && existing !== type) {
        throw new AggregateScopeError(
          `Event type "${eventType}" is owned by both "${existing}" and "${type}"; an event type has one owner on a pipeline`,
          { eventType, owners: [existing, type] },
        );
      }
      eventOwners[eventType] = type;
    }
  }
  return { types, eventOwners };
}

/** The label a single-type surface keeps showing: the first declared type. */
export function primaryAggregateType(scope: AggregateScope): AggregateType {
  return scope.types[0]!;
}

export function isMultiAggregate(scope: AggregateScope): boolean {
  return scope.types.length > 1;
}

export function declaresAggregateType(
  scope: AggregateScope,
  type: AggregateType,
): boolean {
  return scope.types.includes(type);
}

/**
 * The aggregate an event of this type belongs to on this pipeline, or
 * undefined when the scope carries no ownership map or does not own it.
 */
export function owningAggregateType(
  scope: AggregateScope,
  eventType: string,
): AggregateType | undefined {
  return scope.eventOwners?.[eventType];
}

/**
 * Why an event may not be appended through this scope, or undefined when it
 * may. With no ownership map the rule is today's equality; with one, the
 * event's type must be owned by a declared aggregate and the stamp must agree.
 */
export function eventAggregateMismatch(
  scope: AggregateScope,
  event: Pick<Event, "type" | "aggregateType">,
): string | undefined {
  if (!scope.eventOwners) {
    const expected = primaryAggregateType(scope);
    return event.aggregateType === expected
      ? undefined
      : `aggregate type '${event.aggregateType}' does not match pipeline aggregate type '${expected}'`;
  }
  const owner = scope.eventOwners[event.type];
  if (owner === undefined) {
    return `event type '${event.type}' is owned by none of the pipeline's aggregates (${scope.types.join(", ")})`;
  }
  if (owner !== event.aggregateType) {
    return `event type '${event.type}' is owned by aggregate '${owner}' but the event is stamped '${event.aggregateType}'`;
  }
  return undefined;
}

/**
 * The aggregate a command writes. Explicit when registration names one;
 * implied on a single-type pipeline; an error on a multi-aggregate pipeline
 * that leaves it unsaid, because the queue key needs it before any handler
 * runs.
 */
export function commandAggregateType({
  scope,
  commandName,
  declared,
}: {
  scope: AggregateScope;
  commandName: string;
  declared: AggregateType | undefined;
}): AggregateType {
  if (declared !== undefined) {
    if (!declaresAggregateType(scope, declared)) {
      throw new AggregateScopeError(
        `Command "${commandName}" binds to aggregate type "${declared}", which its pipeline does not declare (${scope.types.join(", ")})`,
        { commandName, aggregateType: declared, declared: scope.types },
      );
    }
    return declared;
  }
  if (isMultiAggregate(scope)) {
    throw new AggregateScopeError(
      `Command "${commandName}" must name the aggregate type it writes; its pipeline declares ${scope.types.join(", ")}`,
      { commandName, declared: scope.types },
    );
  }
  return primaryAggregateType(scope);
}

/**
 * The fold-state key for an event. Two aggregates sharing a pipeline share its
 * fold stores and their ids are not disjoint by construction, so on a
 * multi-aggregate pipeline the key is qualified by type. A single-type
 * pipeline keeps the bare id, which is what every existing row is keyed by.
 */
export function foldStateKey(
  scope: AggregateScope,
  event: Pick<Event, "aggregateType" | "aggregateId">,
): string | undefined {
  return isMultiAggregate(scope)
    ? `${event.aggregateType}:${String(event.aggregateId)}`
    : undefined;
}

/**
 * The aggregate segment of a projection's or subscriber's kill-switch key. A
 * projection that folds several aggregates has no one type, so the pipeline
 * name stands in; a single-type pipeline keeps the type, and its keys.
 */
export function componentKillSwitchAggregate({
  scope,
  pipelineName,
}: {
  scope: AggregateScope;
  pipelineName: string;
}): string {
  return isMultiAggregate(scope) ? pipelineName : primaryAggregateType(scope);
}
