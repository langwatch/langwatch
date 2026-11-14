import type { ComponentType } from "react";
import operations from "virtual:docs-operations";
import loaders from "virtual:docs-pages";

import type { Operation } from "../features/api-reference/model.ts";

function EmptyPage() {
  return null;
}

export type PageModule = {
  default: ComponentType;
  frontmatter?: Record<string, unknown>;
  headings?: { depth: number; text: string; id: string }[];
  failed?: boolean;
};

export async function loadPage({ slug }: { slug: string }): Promise<PageModule | null> {
  const loader = loaders[slug];
  if (!loader) return operations[slug] ? { default: EmptyPage, headings: [] } : null;
  const mod = await loader();
  return mod.failed ? null : mod;
}

export async function loadOperation({ slug }: { slug: string }): Promise<Operation | null> {
  const loader = operations[slug];
  return loader ? (await loader()).default : null;
}
