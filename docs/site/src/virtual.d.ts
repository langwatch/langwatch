declare module "virtual:docs-nav" {
  export type NavItem =
    | { type: "page"; slug: string; title: string }
    | { type: "group"; title: string; children: NavItem[] };
  export type PageMeta = {
    title: string;
    description: string;
    sidebarTitle: string;
    openapi: string;
    mode: string;
    icon: string;
  };
  export type SiteMeta = {
    name: string;
    banner: { content: string; dismissible: boolean } | null;
    searchPrompt: string;
    signIn: string;
    github: string;
    notFound: { title: string; description: string };
  };
  const nav: {
    anchors: { title: string; children: NavItem[] }[];
    pages: Record<string, PageMeta>;
    site: SiteMeta;
  };
  export default nav;
}

declare module "virtual:docs-operations" {
  const operations: Record<string, () => Promise<{ default: import("./api/operation.ts").Operation }>>;
  export default operations;
}

declare module "*.mdx" {
  import type { ComponentType } from "react";
  const Component: ComponentType;
  export default Component;
}
