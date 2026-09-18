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
var context_exports = {};
__export(context_exports, {
  captureRenderContext: () => captureRenderContext,
  createContext: () => createContext,
  globalContexts: () => globalContexts,
  runWithRenderContext: () => runWithRenderContext,
  useContext: () => useContext
});
module.exports = __toCommonJS(context_exports);
var import_html = require("../helper/html");
var import_base = require("./base");
var import_constants = require("./constants");
var import_context = require("./dom/context");
const globalContexts = [];
let alsProbed = false;
let asyncLocalStorage;
let fallbackStore;
let fallbackRendersInFlight = 0;
let warnedFallbackDefault = false;
const loadAsyncLocalStorage = () => {
  if (alsProbed) {
    return asyncLocalStorage;
  }
  alsProbed = true;
  const global = globalThis;
  let AsyncLocalStorage;
  for (const probe of [
    // Node.js >= 20.16, Deno, Bun, Cloudflare Workers (nodejs_compat). Property
    // access only, so bundlers don't statically resolve `node:async_hooks`.
    () => global.process?.getBuiltinModule?.("node:async_hooks")?.AsyncLocalStorage,
    // Node.js < 20.16 has no `process.getBuiltinModule`, but a CJS entrypoint
    // exposes the main module's `require` here.
    () => global.process?.mainModule?.require?.("node:async_hooks")?.AsyncLocalStorage
  ]) {
    try {
      AsyncLocalStorage = probe();
    } catch {
    }
    if (AsyncLocalStorage) {
      break;
    }
  }
  if (AsyncLocalStorage) {
    asyncLocalStorage = new AsyncLocalStorage();
  }
  return asyncLocalStorage;
};
const getCurrentStore = () => {
  return loadAsyncLocalStorage()?.getStore() || fallbackStore;
};
const warnIfStorelessAccess = () => {
  if (fallbackRendersInFlight > 0 && !warnedFallbackDefault) {
    warnedFallbackDefault = true;
    console.warn(
      "hono/jsx: AsyncLocalStorage is unavailable in this runtime, so useContext() after an await in an async component falls back to the context default value during server-side rendering. To get provided values across await boundaries, use a runtime with AsyncLocalStorage (Node.js >= 20.16, Deno, Bun, or Cloudflare Workers with the nodejs_compat flag)."
    );
  }
};
const getContextValuesIn = (store, context) => {
  if (!store) {
    warnIfStorelessAccess();
    return context.values;
  }
  let values = store.get(context);
  if (!values) {
    values = [context.values[0]];
    store.set(context, values);
  }
  return values;
};
const readContextValueIn = (store, context) => {
  if (!store) {
    warnIfStorelessAccess();
    return context.values.at(-1);
  }
  const values = store.get(context);
  return values?.length ? values.at(-1) : context.values[0];
};
const captureContextValues = (store) => (store ? globalContexts.filter((c) => store.has(c)) : globalContexts).map((c) => [
  c,
  readContextValueIn(store, c)
]);
const resumeWithContextValues = (callback, store, contexts) => runWithRenderContext(() => {
  const currentStore = getCurrentStore();
  const valuesPerContext = contexts.map(([context, value]) => {
    const values = getContextValuesIn(currentStore, context);
    values.push(value);
    return values;
  });
  const popContextValues = () => {
    valuesPerContext.forEach((values) => {
      values.pop();
    });
  };
  try {
    const result = callback();
    if (result instanceof Promise) {
      return result.finally(popContextValues);
    }
    popContextValues();
    return result;
  } catch (e) {
    popContextValues();
    throw e;
  }
}, store);
const runWithRenderContext = (callback, resumeStore) => {
  if (getCurrentStore()) {
    return callback();
  }
  const store = resumeStore ?? /* @__PURE__ */ new WeakMap();
  const storage = loadAsyncLocalStorage();
  if (storage) {
    return storage.run(store, callback);
  }
  fallbackStore = store;
  let result;
  try {
    result = callback();
  } finally {
    fallbackStore = void 0;
  }
  if (!warnedFallbackDefault && result instanceof Promise) {
    fallbackRendersInFlight++;
    result = result.finally(() => {
      fallbackRendersInFlight--;
    });
  }
  return result;
};
const captureRenderContext = () => {
  const store = getCurrentStore();
  const contexts = captureContextValues(store);
  return (callback) => resumeWithContextValues(callback, store, contexts);
};
const createContext = (defaultValue) => {
  const values = [defaultValue];
  const context = ((props) => {
    const contextValues = getContextValuesIn(getCurrentStore(), context);
    contextValues.push(props.value);
    let string;
    try {
      string = props.children ? (Array.isArray(props.children) ? new import_base.JSXFragmentNode("", {}, props.children) : props.children).toString() : "";
    } catch (e) {
      contextValues.pop();
      throw e;
    }
    if (string instanceof Promise) {
      return string.finally(() => contextValues.pop()).then((resString) => (0, import_html.raw)(resString, resString.callbacks));
    } else {
      contextValues.pop();
      return (0, import_html.raw)(string);
    }
  });
  context.values = values;
  context.Provider = context;
  context[import_constants.DOM_RENDERER] = (0, import_context.createContextProviderFunction)(values);
  globalContexts.push(context);
  return context;
};
const useContext = (context) => {
  return readContextValueIn(getCurrentStore(), context);
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  captureRenderContext,
  createContext,
  globalContexts,
  runWithRenderContext,
  useContext
});
