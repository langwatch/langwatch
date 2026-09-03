/** Portable parameter rendering for a scenario's situation and criteria. */

import { renderLiquid } from "@langwatch/automation-contract";

import type { RunParameterValues } from "./scenario.parameters";

export type ScenarioContentField = "situation" | `criteria[${number}]`;

export type RenderScenarioContentResult =
  | { ok: true; situation: string; criteria: string[] }
  | {
      ok: false;
      reason: "missing_parameters";
      field: ScenarioContentField;
      names: string[];
    }
  | {
      ok: false;
      reason: "template_invalid";
      field: ScenarioContentField;
      message: string;
    };

const PARAMS_NAMESPACE = "params";
const PARAMS_PREFIX = `${PARAMS_NAMESPACE}.`;

function referencedName(path: string): string {
  return path.startsWith(PARAMS_PREFIX) ? path.slice(PARAMS_PREFIX.length) : path;
}

type FieldRenderResult =
  | { ok: true; output: string }
  | { ok: false; reason: "missing_parameters"; names: string[] }
  | { ok: false; reason: "template_invalid"; message: string };

async function renderField({
  template,
  parameters,
}: {
  template: string;
  parameters: RunParameterValues;
}): Promise<FieldRenderResult> {
  try {
    const { output, missingVariables } = await renderLiquid({
      template,
      context: { [PARAMS_NAMESPACE]: parameters },
    });
    if (missingVariables.length > 0) {
      return {
        ok: false,
        reason: "missing_parameters",
        names: missingVariables.map(referencedName),
      };
    }
    return { ok: true, output };
  } catch (error) {
    return {
      ok: false,
      reason: "template_invalid",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Leaves plain scenario prose byte-identical unless parameters were declared
 * or supplied. Declared-but-unset parameters must still fail as missing.
 */
export async function renderScenarioContent({
  situation,
  criteria,
  parameters,
  declaredNames,
}: {
  situation: string;
  criteria: string[];
  parameters: RunParameterValues;
  declaredNames?: readonly string[];
}): Promise<RenderScenarioContentResult> {
  const declared = declaredNames ?? Object.keys(parameters);
  if (declared.length === 0 && Object.keys(parameters).length === 0) {
    return { ok: true, situation, criteria };
  }

  const rendered = await renderField({ template: situation, parameters });
  if (!rendered.ok) {
    return { ...rendered, field: "situation" };
  }

  const renderedCriteria: string[] = [];
  for (const [index, criterion] of criteria.entries()) {
    const result = await renderField({ template: criterion, parameters });
    if (!result.ok) {
      return { ...result, field: `criteria[${index}]` };
    }

    renderedCriteria.push(result.output);
  }

  return { ok: true, situation: rendered.output, criteria: renderedCriteria };
}
