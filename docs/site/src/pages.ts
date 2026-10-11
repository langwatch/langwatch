import type { ComponentType } from "react";
import operations from "virtual:docs-operations";
import type { Operation } from "./api/operation.ts";

function EmptyPage() {
  return null;
}

export type PageModule = {
  default: ComponentType;
  frontmatter?: Record<string, unknown>;
  headings?: { depth: number; text: string; id: string }[];
  failed?: boolean;
};

const loaders = import.meta.glob<PageModule>(["../../**/*.mdx", "!../../site/**", "!../../snippets/**"]);

export async function loadPage({ slug }: { slug: string }): Promise<PageModule | null> {
  const loader = loaders[`../../${slug}.mdx`];
  if (!loader) return operations[slug] ? { default: EmptyPage, headings: [] } : null;
  const mod = await loader();
  return mod.failed ? null : mod;
}

export async function loadOperation({ slug }: { slug: string }): Promise<Operation | null> {
  const loader = operations[slug];
  return loader ? (await loader()).default : null;
}
