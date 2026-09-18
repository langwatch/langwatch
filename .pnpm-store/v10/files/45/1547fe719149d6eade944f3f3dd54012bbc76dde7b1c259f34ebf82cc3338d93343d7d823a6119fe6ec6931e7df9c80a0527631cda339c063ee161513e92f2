/**
 * @module
 * Method Not Allowed Middleware for Hono.
 */
import type { Context } from '../../context';
import type { Hono } from '../../hono';
import type { Env, MiddlewareHandler } from '../../types';
type MethodNotAllowedHandler<E extends Env> = (c: Context<E>, allowedMethods: string[]) => Response | Promise<Response>;
type MethodNotAllowedOptions<E extends Env> = {
    app: Hono<E, any, any>;
    onMethodNotAllowed?: MethodNotAllowedHandler<E>;
};
/**
 * Method Not Allowed Middleware for Hono.
 *
 * Returns a `405 Method Not Allowed` response with an `Allow` header when the request path
 * matches a registered route but the request method is not supported.
 *
 * @param {MethodNotAllowedOptions} options - The options for the middleware.
 * @param {Hono} options.app - The Hono instance used by the application.
 * @param {MethodNotAllowedHandler} [options.onMethodNotAllowed] - Generates the response, including its `Allow` header.
 * @returns {MiddlewareHandler} The middleware handler function.
 *
 * @example
 * ```ts
 * const app = new Hono()
 *
 * app.use(methodNotAllowed({ app }))
 *
 * app.get('/hello', (c) => c.text('Hello!'))
 * app.post('/hello', (c) => c.text('Posted!'))
 *
 * // PUT /hello -> 405 Method Not Allowed
 * // Allow: GET, HEAD, POST
 * ```
 *
 * @example
 * ```ts
 * app.use(
 *   methodNotAllowed({
 *     app,
 *     onMethodNotAllowed: (c, methods) =>
 *       c.json({ error: 'Method Not Allowed' }, 405, { Allow: methods.join(', ') }),
 *   })
 * )
 * ```
 */
export declare const methodNotAllowed: <E extends Env = Env>(options: MethodNotAllowedOptions<E>) => MiddlewareHandler<E>;
export {};
