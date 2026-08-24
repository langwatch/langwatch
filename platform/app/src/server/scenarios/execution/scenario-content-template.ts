/**
 * Renders a scenario's own situation and criteria against the run's resolved
 * parameters, so the simulated user and the judge read the same values the
 * target under test was given.
 *
 * The result is a discriminated union rather than a thrown error: this module
 * knows which field failed and why, and nothing more. Turning that into a
 * customer-facing failure is the caller's job, one level up, where the domain
 * error classes live.
 *
 * @see specs/scenarios/scenario-run-parameters.feature
 */

import { renderLiquid } from "@langwatch/automation-contract";

import type { RunParameterValues } from "../parameters";

/**
 * Which piece of the scenario a failure came from. `criteria[N]` carries the
 * index because a scenario's criteria are a list the author edits by position.
 */
export type ScenarioContentField = "situation" | `criteria[${number}]`;

export type RenderScenarioContentResult =
  | { ok: true; situation: string; criteria: string[] }
  | {
      ok: false;
      reason: "missing_parameters";
      field: ScenarioContentField;
      /** The referenced names that resolved to nothing. */
      names: string[];
    }
  | {
      ok: false;
      reason: "template_invalid";
      field: ScenarioContentField;
      /** Why the render failed, for the log line at the throw site. */
      message: string;
    };

const PARAMS_NAMESPACE = "params";
const PARAMS_PREFIX = `${PARAMS_NAMESPACE}.`;

/**
 * Reports a missing reference by the name the author wrote: `params.region`
 * reads back as `region`, anything else keeps its full path.
 */
function referencedName(path: string): string {
  return path.startsWith(PARAMS_PREFIX)
    ? path.slice(PARAMS_PREFIX.length)
    : path;
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
 * Renders a scenario's situation and criteria for one run.
 *
 * A scenario that neither declares parameters nor receives values is handed
 * back byte-identical, without going near the template engine. That is the
 * whole point of the opt-out: scenario text is prose, and prose contains
 * `{{` and `{%` for reasons that have nothing to do with templating. Only a
 * scenario that opted in by declaring a parameter is read as a template.
 *
 * `declaredNames` is what makes a declared-but-unset name fail as missing
 * rather than silently opting the scenario out. It defaults to the names the
 * run resolved, which is correct whenever every declaration carries a default
 * or a supplied value.
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
  if (!rendered.ok) return { ...rendered, field: "situation" };

  const renderedCriteria: string[] = [];
  for (const [index, criterion] of criteria.entries()) {
    const result = await renderField({ template: criterion, parameters });
    if (!result.ok) return { ...result, field: `criteria[${index}]` };
    renderedCriteria.push(result.output);
  }

  return { ok: true, situation: rendered.output, criteria: renderedCriteria };
}
