import { ConfigurationError } from "../errors";

/**
 * Binds each declared handler key to the type string the pipeline derives for
 * it, once, so dispatch is a map lookup rather than a switch.
 */
export function resolveDispatch<Handler>(args: {
  handlers: Readonly<Record<string, Handler | undefined>>;
  typeOf: (key: string) => string;
  what: string;
  owner: string;
}): Map<string, Handler> {
  const resolved = new Map<string, Handler>();
  for (const [key, handler] of Object.entries(args.handlers)) {
    if (handler === undefined) continue;
    resolved.set(args.typeOf(key), handler);
  }
  if (resolved.size === 0) {
    throw new ConfigurationError(
      `${args.what} "${args.owner}" declares no handlers`,
      {
        owner: args.owner,
      },
    );
  }
  return resolved;
}

/**
 * The one seam where a wire payload becomes a declared payload.
 *
 * A delivered event arrives as `unknown` and is routed by the derived type
 * string, which is what makes it that event's own payload — a guarantee the
 * type system cannot discharge, because the routing happens at runtime over a
 * key it cannot see. So it is asserted here, in one named place with one
 * reason, rather than at each of the five member kinds that dispatch.
 */
export function wireHandler<Args extends unknown[], Result>(
  dispatch: ReadonlyMap<string, (...args: never[]) => unknown>,
  type: string,
): ((...args: Args) => Result) | undefined {
  return dispatch.get(type) as ((...args: Args) => Result) | undefined;
}
