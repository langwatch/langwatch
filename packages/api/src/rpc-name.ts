// ---------------------------------------------------------------------------
// The RPC name grammar, stated twice (ADR 001 §8)
//
// An RPC name is an identifier, not a URL path: no leading slash, dotted
// lower-camelCase segments, at least one dot, no parameters. The type below
// rejects a bad registration in the editor; the regex-backed assert rejects it
// at startup for the callers types cannot reach — a JavaScript caller, a config
// widened on its way through a helper, anything behind an `any`. One test table
// (`rpc-types.unit.test.ts`) drives both statements, so a change to either that
// forgets the other fails there.
// ---------------------------------------------------------------------------

type LowerAlpha =
  | "a"
  | "b"
  | "c"
  | "d"
  | "e"
  | "f"
  | "g"
  | "h"
  | "i"
  | "j"
  | "k"
  | "l"
  | "m"
  | "n"
  | "o"
  | "p"
  | "q"
  | "r"
  | "s"
  | "t"
  | "u"
  | "v"
  | "w"
  | "x"
  | "y"
  | "z";

type Digit = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9";

type AlphaNum = LowerAlpha | Uppercase<LowerAlpha> | Digit;

/** True when every character of `S` is `[A-Za-z0-9]`. `""` is vacuously true. */
type IsAlphaNum<S extends string> = S extends ""
  ? true
  : S extends `${infer Head}${infer Rest}`
    ? Head extends AlphaNum
      ? IsAlphaNum<Rest>
      : false
    : false;

/** True for one lower-camelCase segment: a lowercase letter then `[A-Za-z0-9]*`. */
type IsSegment<S extends string> = S extends `${infer Head}${infer Rest}`
  ? Head extends LowerAlpha
    ? IsAlphaNum<Rest>
    : false
  : false;

/** True for `<segment>(.<segment>)*` — the tail, so zero further dots is fine. */
type IsDottedTail<S extends string> = S extends `${infer Head}.${infer Rest}`
  ? IsSegment<Head> extends true
    ? IsDottedTail<Rest>
    : false
  : IsSegment<S>;

/** True for `<segment>(.<segment>)+`. The `${string}.${string}` test is what requires the dot. */
type IsRpcName<S extends string> = S extends `${string}.${string}`
  ? IsDottedTail<S>
  : false;

/**
 * Carries the rule into the compiler's message. TypeScript prints the alias
 * name rather than expanding it, so a bad name reports as
 * `not assignable to parameter of type '"things" &
 * RpcNameMustBeDottedLowerCamelCase'` — which names what was wrong, where the
 * bare `never` an intersection of two string literals would collapse to says
 * only that something is.
 */
interface RpcNameMustBeDottedLowerCamelCase {
  readonly __rpcName: 'a dotted <resource>.<verb> name, e.g. "things.create"';
}

/**
 * Resolves to `unknown` for a legal name — so `TName & RpcName<TName>` is just
 * `TName`, and `TName` still infers from the naked member — and to a shape no
 * string satisfies for an illegal one.
 */
export type RpcName<TName extends string> =
  IsRpcName<TName> extends true ? unknown : RpcNameMustBeDottedLowerCamelCase;

/**
 * `<resource>.<verb>`, lower camelCase on both sides, at least one dot, no
 * leading slash, no path parameters. Pinning the grammar here rather than in
 * review is the point: a convention that lives only in a document drifts.
 */
const RPC_NAME_RE = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/;

/**
 * True when `name` is a legal RPC name. Exported so a consumer that has to
 * recognise one after the fact — the discovery catalogue reads them back out of
 * the published OpenAPI document — asks this grammar rather than writing a
 * second one that agrees until it doesn't.
 */
export function isRpcPath(name: string): boolean {
  return RPC_NAME_RE.test(name);
}

export function assertRpcName(name: string): void {
  if (!RPC_NAME_RE.test(name)) {
    throw new Error(
      `RPC endpoint name "${name}" must be a dotted <resource>.<verb> name in ` +
        `lower camelCase with no leading slash and no path parameters, ` +
        `e.g. "things.create"`,
    );
  }
}
