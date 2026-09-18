import type { IncomingMessage, ServerResponse } from "node:http";

import { getRequestListener } from "@hono/node-server";
import { Hono } from "hono";

export type HttpHandler = (request: Request) => Response | Promise<Response>;
export type NodeHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => void | Promise<void>;
export type HttpExchange = Readonly<{
  request: Request;
  socketAddress: string | undefined;
  headers: Headers;
}>;
export type HttpMiddleware = Readonly<{ handle(exchange: HttpExchange): void }>;
export type HttpReporter = Readonly<{ error(context: object, message: string): void }>;
export type HttpFailureAnswer = (failure: unknown) => Response;
export type HttpTarget = Readonly<{
  fetch: HttpHandler;
  onFailure?: HttpFailureAnswer;
}>;
type Route = { prefix: string; target: HttpTarget };

/** Registers the most specific prefix first; targets retain the original request URL. */
export class HttpMux {
  static create(options: { reporter?: HttpReporter } = {}): HttpMux {
    return new HttpMux(options.reporter);
  }

  readonly #middleware: HttpMiddleware[] = [];
  readonly #routes: Route[] = [];
  #router: Hono | undefined;
  readonly #reporter: HttpReporter | undefined;

  private constructor(reporter: HttpReporter | undefined) {
    this.#reporter = reporter;
  }

  use(middleware: HttpMiddleware): this {
    this.#assertMutable();
    this.#middleware.push(middleware);

    return this;
  }

  route(
    prefix: string,
    target: HttpTarget | HttpHandler,
    options: { onFailure?: HttpFailureAnswer } = {},
  ): this {
    this.#assertMutable();

    if (!/^\/(?:[^/?#]+(?:\/[^/?#]+)*)?$/.test(prefix)) {
      throw new Error(`Invalid HTTP route prefix "${prefix}".`);
    }

    if (this.#routes.some((route) => route.prefix === prefix)) {
      throw new Error(`Two routes claim "${prefix}".`);
    }

    let resolved: HttpTarget;

    if (typeof target === "function") resolved = { fetch: target };
    else resolved = target;

    const onFailure = options.onFailure ?? resolved.onFailure;

    this.#routes.push({
      prefix,
      target: { fetch: (request) => resolved.fetch(request), onFailure },
    });

    return this;
  }

  fetch = async (request: Request, socketAddress?: string): Promise<Response> => {
    const router = this.#compile();
    const exchange: HttpExchange = { request, socketAddress, headers: new Headers() };
    let failure: unknown;
    let failed = false;

    // All preamble policies run, so an earlier failure cannot omit the security floor.
    for (const middleware of this.#middleware) {
      try {
        middleware.handle(exchange);
      } catch (error) {
        if (!failed) failure = error;

        failed = true;
      }
    }

    let response: Response;

    try {
      if (failed) response = this.#answerFailure(failure, request);
      else response = await router.fetch(request);
    } catch (error) {
      response = this.#answerFailure(error, request);
    }

    const headers = new Headers(response.headers);

    exchange.headers.forEach((value, name) => {
      if (!headers.has(name)) headers.set(name, value);
    });

    let body = response.body;

    if (request.method === "HEAD") {
      await body?.cancel();
      body = null;
    }

    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };

  get handler(): NodeHandler {
    this.#compile();

    return getRequestListener(
      (request, environment) => this.fetch(request, environment.incoming.socket.remoteAddress),
      { overrideGlobalObjects: false },
    );
  }

  #compile(): Hono {
    if (this.#router) return this.#router;

    const router = new Hono();
    this.#routes.sort((left, right) => right.prefix.length - left.prefix.length);

    for (const { prefix, target } of this.#routes) {
      const paths = prefix === "/" ? ["*"] : [prefix, `${prefix}/*`];
      for (const route of paths) router.all(route, (context) => target.fetch(context.req.raw));
    }

    router.onError((failure, context) => this.#answerFailure(failure, context.req.raw));
    this.#router = router;

    return router;
  }

  #answerFailure(failure: unknown, request: Request): Response {
    const pathname = new URL(request.url).pathname;

    const route = this.#routes.find(
      ({ prefix }) => prefix === "/" || pathname === prefix || pathname.startsWith(`${prefix}/`),
    );

    try {
      this.#reporter?.error({ error: failure, path: pathname }, "a request was not answered");

      return route?.target.onFailure?.(failure) ?? new Response(null, { status: 500 });
    } catch {
      return new Response(null, { status: 500 });
    }
  }

  #assertMutable(): void {
    if (this.#router) throw new Error("HTTP routes and middleware are sealed once serving starts.");
  }
}
