import type { Plugin } from "vite";

// Bundled dev evaluates react-dom before plugin-react's inlined preamble, so React finds no
// DevTools hook and Fast Refresh has no renderer. This early script installs a hook that
// records injections (the refresh runtime adopts them later) and the no-op registration stubs.
export const BUNDLED_REFRESH_PREAMBLE = [
  "(function(){var r=new Map(),n=0;",
  "window.__REACT_DEVTOOLS_GLOBAL_HOOK__={renderers:r,supportsFiber:true,",
  "inject:function(i){var id=n++;r.set(id,i);return id},",
  "onScheduleFiberRoot:function(){},onCommitFiberRoot:function(){},onCommitFiberUnmount:function(){}};",
  "window.$RefreshReg$=function(){};window.$RefreshSig$=function(){return function(t){return t}};})();",
].join("");

/** In bundled dev only: the preamble runs first in `<head>`, before any module. */
export function bundledRefresh(): Plugin {
  return {
    name: "bundled-refresh",
    apply: "serve",
    transformIndexHtml: () => [
      { tag: "script", children: BUNDLED_REFRESH_PREAMBLE, injectTo: "head-prepend" },
    ],
  };
}
