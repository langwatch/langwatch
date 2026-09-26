/** The parameter line as scenario lends it to agent's test panel (§3.4 rule 7). */

import type { UiParameterLineFieldProps } from "@langwatch/browser-host/declarations";

import type { DeclaredParameter } from "../../../../behavior/suites/use-run-suite.ts";
import { ParameterLineField } from "./parameter-line-field.tsx";
import { parameterPlaceholder } from "./parameter-suggestions.ts";

/** Every parameter the panel hands over is the agent's own, so each row is tagged with it. */
export function LentParameterLineField({ definitions, ...field }: UiParameterLineFieldProps) {
  const declared: DeclaredParameter[] = definitions.map((definition) => ({
    ...definition,
    source: "agent",
  }));
  return (
    <ParameterLineField
      {...field}
      definitions={declared}
      placeholder={parameterPlaceholder(declared)}
    />
  );
}
