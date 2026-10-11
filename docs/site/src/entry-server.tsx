import { renderToString } from "react-dom/server";
import nav from "virtual:docs-nav";
import { App } from "./app.tsx";
import { loadPage } from "./pages.ts";

export async function render({ slug }: { slug: string }) {
  const page = await loadPage({ slug });
  if (!page) throw new Error("page module failed to compile");
  const meta = nav.pages[slug];
  return {
    html: renderToString(<App slug={slug} page={page} />),
    title: `${meta?.title ?? slug} | LangWatch Docs`,
    description: meta?.description ?? "",
  };
}
