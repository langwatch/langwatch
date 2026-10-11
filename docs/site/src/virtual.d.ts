declare module "virtual:docs-nav" {
  export type NavItem =
    | { type: "page"; slug: string; title: string }
    | { type: "group"; title: string; children: NavItem[] };
  export type PageMeta = { title: string; description: string; sidebarTitle: string; openapi: string };
  const nav: { anchors: { title: string; children: NavItem[] }[]; pages: Record<string, PageMeta> };
  export default nav;
}

declare module "*.mdx" {
  import type { ComponentType } from "react";
  const Component: ComponentType;
  export default Component;
}
