import { agentPrompt, generateExample, paramKey } from "../model/codegen.ts";
import type { RequestState } from "../model/codegen.ts";
import { paramText } from "../model/field-value.ts";
import { EXAMPLE_LANGUAGES } from "../model/operation.ts";
import type { Operation } from "../model/operation.ts";
import { fieldValue } from "./playground-dom.ts";

/** Parameters as they go out (a picked date as an ISO timestamp), and the body in `#pg-body`. */
export function requestState({ operation }: { operation: Operation }): RequestState {
  return {
    values: Object.fromEntries(
      operation.parameters.map((param) => [
        paramKey({ location: param.in, name: param.name }),
        paramText({ param, raw: fieldValue({ id: `pg-${param.in}-${param.name}` }) }).text,
      ]),
    ),
    body: fieldValue({ id: "pg-body" }),
  };
}

/** Parameter values that cannot be sent, such as a number past its maximum. */
export function paramErrors({ operation }: { operation: Operation }) {
  const errors: Record<string, string> = {};
  for (const param of operation.parameters) {
    const { error } = paramText({ param, raw: fieldValue({ id: `pg-${param.in}-${param.name}` }) });
    if (error) errors[paramKey({ location: param.in, name: param.name })] = error;
  }
  return errors;
}

function setExample({ id, code }: { id: string; code: string }) {
  const region = document.querySelector<HTMLElement>(
    `section[aria-label="Request example"] [data-docs-example="${id}"] .docs-code-region`,
  );
  if (!region) return;
  region.dataset.code = code;
  const content = region.querySelector("code");
  if (content) content.textContent = code;
}

export function updateExamples({ operation }: { operation: Operation }) {
  const state = requestState({ operation });
  for (const entry of EXAMPLE_LANGUAGES)
    setExample({ id: entry.id, code: generateExample({ operation, state, language: entry.id }) });
  const reference =
    document.querySelector<HTMLElement>("[data-docs-reference]")?.dataset.docsReference;
  if (reference) setExample({ id: "agent", code: agentPrompt({ operation, state, reference }) });
}
