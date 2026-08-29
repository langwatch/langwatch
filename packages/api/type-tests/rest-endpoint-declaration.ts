/**
 * What a REST endpoint must declare, asserted at the type level.
 *
 * Each of these is a rule the compiler enforces rather than a convention a
 * reviewer applies. The negative cases use `@ts-expect-error`, which fails the
 * build if the line ever STOPS being an error — so widening the surface breaks
 * this file rather than quietly removing a guarantee from every endpoint.
 */
import type { RestEndpoint, RestEndpointHandler, ScopeIdsIn } from "@langwatch/api/rest";
import { z } from "zod";

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false;
type Assert<Value extends true> = Value;

const scopedInput = z.object({ projectId: z.string(), name: z.string() });
const unscopedInput = z.object({ name: z.string() });
const output = z.object({ ok: z.boolean() });

type Context = Parameters<RestEndpointHandler<{ app: true }, undefined, undefined>>[0];

// ---------------------------------------------------------------------------
// A handler is given input only when input was declared
// ---------------------------------------------------------------------------

type WithInput = RestEndpointHandler<unknown, typeof unscopedInput, typeof output>;
type WithoutInput = RestEndpointHandler<unknown, undefined, typeof output>;

type _InputArrivesValidated = Assert<Equal<Parameters<WithInput>[1], { name: string }>>;
/** Not merely optional — the parameter does not exist, so it cannot be read. */
type _NoInputMeansNoParameter = Assert<Equal<Parameters<WithoutInput>["length"], 1>>;

// ---------------------------------------------------------------------------
// A handler may answer only when output was declared
// ---------------------------------------------------------------------------

type _DeclaredOutputIsTheResult = Assert<
  Equal<ReturnType<WithInput>, { ok: boolean } | Promise<{ ok: boolean }>>
>;
type _NoOutputMeansNoAnswer = Assert<
  Equal<ReturnType<RestEndpointHandler<unknown, undefined, undefined>>, void | Promise<void>>
>;

// ---------------------------------------------------------------------------
// The scope ids an endpoint's own input declares
// ---------------------------------------------------------------------------

type _ScopeIdIsFound = Assert<Equal<ScopeIdsIn<typeof scopedInput>, "projectId">>;
type _NoScopeIdIsNever = Assert<Equal<ScopeIdsIn<typeof unscopedInput>, never>>;
type _NoInputIsNever = Assert<Equal<ScopeIdsIn<undefined>, never>>;

// ---------------------------------------------------------------------------
// Declaring an endpoint
// ---------------------------------------------------------------------------

declare const endpoint: RestEndpoint<{ app: true }>;

/** The complete declaration: policy, both limits, and the scope binding. */
const complete = endpoint
  .withInput(scopedInput)
  .withOutput(output)
  .withPermission("project:view", { scope: "projectId" })
  .withRateLimit()
  .withoutResourceLimit("read of an already-scoped row")
  .handle((_context: Context, input) => ({ ok: input.projectId.length > 0 }));

type _HandledIsRecorded = Assert<
  Equal<typeof complete, RestEndpoint<{ app: true }, typeof scopedInput, typeof output, true, true, true, true, true>>
>;

/** An endpoint that takes nothing and answers nothing is complete as it is. */
endpoint
  .withPermission("project:view")
  .withRateLimit()
  .withoutResourceLimit("nothing to limit")
  .handle(() => {});

// --- the refusals ----------------------------------------------------------
//
// Asserted on the type rather than with `@ts-expect-error`: the directive only
// covers the line after it, and in a multi-line chain the error lands wherever
// the offending call happens to sit. These say what is refused and where.

/**
 * Whether `.handle()` can be called at all.
 *
 * Read off the `this` parameter, which the type-state collapses to `never` for
 * an incomplete declaration. Asked with `extends` instead, every endpoint
 * answers `false` — `never` is assignable to anything, so the check would pass
 * vacuously and assert nothing. It did, until this comment existed.
 */
type HandleAccepts<TEndpoint extends { handle: (...args: never[]) => unknown }> = [
  ThisParameterType<TEndpoint["handle"]>,
] extends [never]
  ? false
  : true;

/**
 * The input names a projectId and the permission never said it was about THAT
 * project. Unbound, the check falls back to the credential's own scope while
 * the handler reads the input's — which is how a caller reads another tenant
 * holding a permission they genuinely have.
 */
type _ScopedInputMustBindItsPermission = Assert<
  Equal<
    HandleAccepts<
      RestEndpoint<unknown, typeof scopedInput, typeof output, true, true, true, false, false>
    >,
    false
  >
>;

/** No access policy at all: neither a permission nor a written opt-out. */
type _PolicyIsMandatory = Assert<
  Equal<
    HandleAccepts<
      RestEndpoint<unknown, typeof unscopedInput, typeof output, false, true, true, false, true>
    >,
    false
  >
>;

/** Both limits are mandatory too, each with an opt-out that must be justified. */
type _RateLimitIsMandatory = Assert<
  Equal<
    HandleAccepts<
      RestEndpoint<unknown, typeof unscopedInput, typeof output, true, false, true, false, true>
    >,
    false
  >
>;
type _ResourceLimitIsMandatory = Assert<
  Equal<
    HandleAccepts<
      RestEndpoint<unknown, typeof unscopedInput, typeof output, true, true, false, false, true>
    >,
    false
  >
>;

/** An endpoint already handled cannot be handled twice. */
type _HandledOnce = Assert<
  Equal<
    HandleAccepts<
      RestEndpoint<unknown, typeof unscopedInput, typeof output, true, true, true, true, true>
    >,
    false
  >
>;

/** A complete declaration is, of course, accepted. */
type _CompleteIsAccepted = Assert<
  Equal<
    HandleAccepts<
      RestEndpoint<unknown, typeof scopedInput, typeof output, true, true, true, false, true>
    >,
    true
  >
>;

declare const scoped: RestEndpoint<unknown, typeof scopedInput>;
declare const unscoped: RestEndpoint<unknown, typeof unscopedInput>;

// @ts-expect-error — the binding must name a field the input actually
// declares, so a typo is a compile error rather than an unchecked id.
scoped.withPermission("project:view", { scope: "projetcId" });

// @ts-expect-error — an endpoint whose input names no scope has nothing to
// bind, so the two-argument form is refused rather than silently ignored.
unscoped.withPermission("project:view", { scope: "projectId" });

// @ts-expect-error — an input that names a scope must bind it; the
// one-argument form is refused.
scoped.withPermission("project:view");
