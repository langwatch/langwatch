import { Flex } from "@langwatch/design-system/primitives";
import { useState } from "react";

import type { CodeSource } from "../../code/ui/code-parts.tsx";
import { generateExample, initialBodyOf } from "../model/codegen.ts";
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
  const [state, setState] = useState<RequestState>({
    values: {},
    body: initialBodyOf({ operation }),
  });
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

  return (
    <Flex
      direction="column"
      gap="6"
      minWidth="0"
      data-type-mode="productive"
      data-docs-playground=""
    >
      <PlaygroundRequest
        operation={operation}
        state={state}
        onChange={setState}
        onTouched={() => setTouched(true)}
        curl={examples.curl.code}
      >
        <ResponsiveExamples>
          <RequestExamples examples={examples} />
          <ResponseExample operation={operation} />
        </ResponsiveExamples>
      </PlaygroundRequest>
      <span className="docs-sr-only">{slug}</span>
    </Flex>
  );
}
