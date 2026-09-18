// src/middleware/method-not-allowed/index.ts
import { basePath, matchedRoutes } from "../../helper/route/index.js";
import { METHOD_NAME_ALL } from "../../router.js";
import { TrieRouter } from "../../router/trie-router/index.js";
var methodNotAllowed = (options) => {
  let methodRouter;
  return async function methodNotAllowed2(c, next) {
    const routeIndex = c.req.routeIndex;
    await next();
    if (c.res.status !== 404) {
      return;
    }
    if (c.error) {
      return;
    }
    if (!methodRouter) {
      const methodsByPath = /* @__PURE__ */ new Map();
      for (const route of options.app.routes) {
        if (route.method === METHOD_NAME_ALL || route.method === "HEAD") {
          continue;
        }
        const methods2 = methodsByPath.get(route.path) ?? /* @__PURE__ */ new Set();
        methods2.add(route.method);
        if (route.method === "GET") {
          methods2.add("HEAD");
        }
        methodsByPath.set(route.path, methods2);
      }
      methodRouter = new TrieRouter();
      for (const [path, methods2] of methodsByPath) {
        methodRouter.add(METHOD_NAME_ALL, path, [...methods2]);
      }
    }
    let requestPath = c.req.path;
    const routes = matchedRoutes(c);
    const currentRoute = routes[routeIndex];
    const sourceRoute = options.app.routes.find((route) => route.handler === methodNotAllowed2);
    if (currentRoute && sourceRoute) {
      const currentBasePathParts = basePath(c, routeIndex).split("/").filter(Boolean);
      const sourceBasePathLength = sourceRoute.basePath.split("/").filter(Boolean).length;
      const mountBasePathParts = currentBasePathParts.slice(
        0,
        currentBasePathParts.length - sourceBasePathLength
      );
      if (mountBasePathParts.length > 0) {
        const mountBasePath = `/${mountBasePathParts.join("/")}`;
        requestPath = c.req.path.slice(mountBasePath.length) || "/";
      }
    }
    const allowedMethods = /* @__PURE__ */ new Set();
    for (const [methods2] of methodRouter.match(METHOD_NAME_ALL, requestPath)[0]) {
      for (const method of methods2) {
        allowedMethods.add(method);
      }
    }
    if (allowedMethods.size === 0 || allowedMethods.has(c.req.method)) {
      return;
    }
    c.res.headers.delete("Allow");
    c.res.headers.delete("Content-Length");
    const methods = [...allowedMethods];
    const allow = methods.join(", ");
    c.res = options.onMethodNotAllowed ? await options.onMethodNotAllowed(c, methods) : c.text("Method Not Allowed", 405, { Allow: allow });
  };
};
export {
  methodNotAllowed
};
