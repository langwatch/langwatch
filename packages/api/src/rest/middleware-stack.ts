import type { Context, MiddlewareHandler } from "hono";

/**
 * Runs a pre-built stack outside Hono's router and preserves short-circuiting.
 * Assigning each response to context mirrors Hono and keeps headers written by
 * outer `finally` blocks on the returned response.
 */
export async function runMiddlewareStack(
  stack: MiddlewareHandler[],
  context: Context,
): Promise<Response | undefined> {
  let index = 0;
  const dispatch = async (): Promise<Response | undefined> => {
    const handler = stack[index++];
    if (!handler) {
      return void 0;
    }

    let inner: Response | undefined;
    const returned = await handler(context, async () => {
      inner = await dispatch();
    });
    const response = returned instanceof Response ? returned : inner;
    if (response) {
      context.res = response;
    }
    return response;
  };
  return dispatch();
}
