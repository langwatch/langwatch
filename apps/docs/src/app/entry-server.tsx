import { renderToString } from "react-dom/server";
import nav from "virtual:docs-nav";

import { generateExample, initialBodyOf } from "../features/api-reference/model/codegen.ts";
import { EXAMPLE_LANGUAGES } from "../features/api-reference/model/operation.ts";
import type { HighlightedExamples } from "../features/api-reference/model/operation.ts";
import { highlightLines } from "../features/code/compile/highlight.ts";
import { headDescription } from "../features/discovery/compile/page-head.ts";
import { App } from "./app.tsx";
import { loadOperation, loadPage } from "./pages.ts";

async function highlightedExamples({
  slug,
}: {
  slug: string;
}): Promise<{ examples?: HighlightedExamples }> {
  const operation = await loadOperation({ slug });
  if (!operation) return {};
  const state = { values: {}, body: initialBodyOf({ operation }) };
  const examples: HighlightedExamples = { python: [], typescript: [], curl: [] };
  for (const entry of EXAMPLE_LANGUAGES) {
    examples[entry.id] = await highlightLines({
      code: generateExample({ operation, state, language: entry.id }),
      lang: entry.lang,
    });
  }
  return { examples };
}

export async function render({ slug }: { slug: string }) {
  const page = await loadPage({ slug });
  if (!page && slug !== "404") throw new Error("page module failed to compile");
  const operation = await loadOperation({ slug });
  const { examples } = await highlightedExamples({ slug });
  const meta = nav.pages[slug];
  return {
    html: renderToString(<App slug={slug} page={page} operation={operation} examples={examples} />),
    title: meta?.title ?? slug,
    description: headDescription({
      title: meta?.title ?? slug,
      description: meta?.description,
      operation,
    }),
    examples,
    operation,
    headings: page?.headings ?? [],
  };
}
