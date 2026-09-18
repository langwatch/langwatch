var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var method_not_allowed_exports = {};
__export(method_not_allowed_exports, {
  methodNotAllowed: () => methodNotAllowed
});
module.exports = __toCommonJS(method_not_allowed_exports);
var import_route = require("../../helper/route");
var import_router = require("../../router");
var import_trie_router = require("../../router/trie-router");
const methodNotAllowed = (options) => {
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
        if (route.method === import_router.METHOD_NAME_ALL || route.method === "HEAD") {
          continue;
        }
        const methods2 = methodsByPath.get(route.path) ?? /* @__PURE__ */ new Set();
        methods2.add(route.method);
        if (route.method === "GET") {
          methods2.add("HEAD");
        }
        methodsByPath.set(route.path, methods2);
      }
      methodRouter = new import_trie_router.TrieRouter();
      for (const [path, methods2] of methodsByPath) {
        methodRouter.add(import_router.METHOD_NAME_ALL, path, [...methods2]);
      }
    }
    let requestPath = c.req.path;
    const routes = (0, import_route.matchedRoutes)(c);
    const currentRoute = routes[routeIndex];
    const sourceRoute = options.app.routes.find((route) => route.handler === methodNotAllowed2);
    if (currentRoute && sourceRoute) {
      const currentBasePathParts = (0, import_route.basePath)(c, routeIndex).split("/").filter(Boolean);
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
    for (const [methods2] of methodRouter.match(import_router.METHOD_NAME_ALL, requestPath)[0]) {
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  methodNotAllowed
});
