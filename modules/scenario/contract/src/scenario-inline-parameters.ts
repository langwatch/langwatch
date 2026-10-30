/**
 * Inline run parameters: `{ key: value }` in a scenario's situation.
 * @see dev/docs/adr/180-scenario-run-hooks.md
 */

import {
  parseScenarioParameterDefinitions,
  scenarioParameterDefinitionSchema,
  type ScenarioParameterDefinition,
} from "./scenario.parameters.ts";

/** Single braces only: `{{ ... }}` around a declaration stays Liquid's to read. */
const INLINE_DECLARATION = /(?<!\{)\{[ \t]*([A-Za-z_][A-Za-z0-9_]*)[ \t]*:([^{}\n]*)\}(?!\})/g;

/** What the situation declares inline, and the text Liquid renders in its place. */
export type InlineRunParameters = {
  /** The situation with each declaration replaced by a `params` reference. */
  template: string;
  /** One definition per name, carrying the first default written for it. */
  definitions: ScenarioParameterDefinition[];
};

/**
 * Reads every `{ key: value }` declaration out of a situation. Each one
 * becomes `{{ params.key }}`, so the run's resolved value shows where the
 * declaration was. Anything that is not a valid declaration stays as text.
 */
export function extractInlineRunParameters({ text }: { text: string }): InlineRunParameters {
  const byName = new Map<string, ScenarioParameterDefinition>();
  const template = text.replace(INLINE_DECLARATION, (declaration, name: string, raw: string) => {
    const parsed = scenarioParameterDefinitionSchema.safeParse({
      name,
      defaultValue: raw.trim(),
    });
    if (!parsed.success || raw.trim() === "") return declaration;
    if (!byName.has(name)) byName.set(name, parsed.data);
    return `{{ params.${name} }}`;
  });
  return { template, definitions: [...byName.values()] };
}

/**
 * The parameters a scenario declares, stored and inline, and the situation
 * to render. A stored declaration wins over an inline one of the same name,
 * so a secret never gains a default from the text.
 */
export function declaredScenarioParameters({
  parameters,
  situation,
}: {
  parameters: unknown;
  situation: string;
}): { definitions: ScenarioParameterDefinition[]; situation: string } {
  const stored = parseScenarioParameterDefinitions(parameters);
  const inline = extractInlineRunParameters({ text: situation });
  const storedNames = new Set(stored.map((definition) => definition.name));
  return {
    definitions: [
      ...stored,
      ...inline.definitions.filter((definition) => !storedNames.has(definition.name)),
    ],
    situation: inline.template,
  };
}
