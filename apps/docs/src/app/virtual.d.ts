/* Vite plugins serve the `virtual:docs-*` modules; tsconfig `paths` maps each
   to its typed declaration in ./virtual/. */
declare module "*.mdx" {
  import type { ComponentType } from "react";
  const Component: ComponentType;
  export default Component;
}
