import { Flex } from "@langwatch/design-system/primitives";
import { useState } from "react";

import { docsUrl, publicSlug } from "../../../lib/site-path.ts";
import type { CodeSource } from "../../code/model.ts";
import { playgroundBodyOf } from "../model/body-value.ts";
import { agentPrompt, generateExample } from "../model/codegen.ts";
import type { RequestState } from "../model/codegen.ts";
import { EXAMPLE_LANGUAGES } from "../model/operation.ts";
import type { HighlightedExamples, Operation } from "../model/operation.ts";
import { plainLines } from "../model/playground-source.ts";
import { RequestExamples, ResponseExample } from "./playground-examples.tsx";
import { PlaygroundRequest } from "./playground-request.tsx";
import { ResponsiveExamples } from "./responsive-examples.tsx";

export function Playground({
  operation,
  highlighted,
  slug,
}: {
  operation: Operation;
  highlighted?: HighlightedExamples;
  slug: string;
}) {
  const seed = playgroundBodyOf({ operation });
  const [state, setState] = useState<RequestState>({ values: {}, body: seed.body });
  const [touched, setTouched] = useState(false);
  const examples = Object.fromEntries(
    EXAMPLE_LANGUAGES.map((entry) => {
      const code = generateExample({ operation, state, language: entry.id });
      const initial = highlighted?.[entry.id];
      const lines = !touched && initial ? initial : plainLines({ code });
      const source: CodeSource = {
        lang: entry.lang,
        title: entry.label,
        code,
        lines,
        highlight: [],
        numbered: false,
      };
      return [entry.id, source];
    }),
  );
  const reference = docsUrl({ path: `/${publicSlug({ slug })}.md` });
  const prompt = agentPrompt({ operation, state, reference });
  const agent: CodeSource = {
    lang: "markdown",
    title: "Agent prompt",
    code: prompt,
    lines: plainLines({ code: prompt }),
    highlight: [],
    numbered: false,
  };

  return (
    <Flex
      direction="column"
      gap="6"
      minWidth="0"
      data-type-mode="productive"
      data-docs-playground=""
      // Session recorders on the docs leave the reader's requests and answers out.
      className="ph-no-capture"
      data-hj-suppress=""
    >
      <PlaygroundRequest
        operation={operation}
        seed={seed}
        state={state}
        onChange={setState}
        onTouched={() => setTouched(true)}
      >
        <ResponsiveExamples>
          <RequestExamples examples={examples} agent={agent} reference={reference} />
          <ResponseExample operation={operation} />
        </ResponsiveExamples>
      </PlaygroundRequest>
      <span className="docs-sr-only">{slug}</span>
    </Flex>
  );
}
