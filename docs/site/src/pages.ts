import type { ComponentType } from "react";

export type PageModule = {
  default: ComponentType;
  frontmatter?: Record<string, unknown>;
  failed?: boolean;
};

const loaders = import.meta.glob<PageModule>(["../../**/*.mdx", "!../../site/**", "!../../snippets/**"]);

export async function loadPage({ slug }: { slug: string }): Promise<PageModule | null> {
  const loader = loaders[`../../${slug}.mdx`];
  if (!loader) return null;
  const mod = await loader();
  return mod.failed ? null : mod;
}
