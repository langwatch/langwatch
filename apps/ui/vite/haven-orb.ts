import path from "node:path";

import type { HtmlTagDescriptor, Plugin } from "vite";

/** Haven sets this on every child it starts; plain `pnpm dev` leaves it unset, so no orb. */
export const HAVEN_SLUG_ENV = "LANGWATCH_SLUG";

const ORB_ENTRY = path.join(import.meta.dirname, "haven-orb", "orb-client.ts");

/** End of head: after plugin-react's preamble (its .tsx needs it), before the app entry in body. */
export function havenOrbTags({ slug }: { slug: string | undefined }): HtmlTagDescriptor[] {
  if (!slug) return [];
  return [
    { tag: "script", attrs: { type: "module", src: `/@fs${ORB_ENTRY}` }, injectTo: "head" },
  ];
}

/** The haven dev orb (specs/setup/haven-dev-orb.feature); `apply: "serve"` skips builds. */
export function havenOrb({ slug }: { slug: string | undefined }): Plugin {
  return { name: "haven-orb", apply: "serve", transformIndexHtml: () => havenOrbTags({ slug }) };
}
