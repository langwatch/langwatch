import { Context, Env, MiddlewareHandler } from "hono";

//#region src/serve-static.d.ts
type ServeStaticOptions<E extends Env = Env> = {
  /**
   * Root path. Relative path is based on current working directory from which the app was started.
   */
  root?: string;
  path?: string;
  index?: string;
  precompressed?: boolean;
  rewriteRequestPath?: (path: string, c: Context<E>) => string;
  onFound?: (path: string, c: Context<E>) => void | Promise<void>;
  onNotFound?: (path: string, c: Context<E>) => void | Promise<void>;
};
declare const serveStatic: <E extends Env = any>(options?: ServeStaticOptions<E>) => MiddlewareHandler<E>;
//#endregion
export { ServeStaticOptions, serveStatic };