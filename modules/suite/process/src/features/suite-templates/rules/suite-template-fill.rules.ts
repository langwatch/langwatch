import type { RedTeamConfig, ScenarioKind } from "@langwatch/scenario-contract";
import type {
  SuiteTemplate,
  SuiteTemplateFit,
  SuiteTemplateScenario,
} from "@langwatch/suite-contract";

import { owaspAgenticTop10Template } from "./owasp-agentic-top-10.rules.ts";
import { owaspLlmTop10Template } from "./owasp-llm-top-10-2025.rules.ts";
import { paymentsAgentTemplate } from "./payments-agent.rules.ts";
import { piiSensitiveDataTemplate } from "./pii-sensitive-data.rules.ts";
import { promptInjectionTemplate } from "./prompt-injection.rules.ts";
import { supportAgentTemplate } from "./support-agent.rules.ts";

/** Every shipped suite template, sorted by kind then title. */
export const SUITE_TEMPLATES: readonly SuiteTemplate[] = [
  owaspLlmTop10Template,
  owaspAgenticTop10Template,
  piiSensitiveDataTemplate,
  promptInjectionTemplate,
  supportAgentTemplate,
  paymentsAgentTemplate,
].toSorted(
  (left, right) => left.kind.localeCompare(right.kind) || left.title.localeCompare(right.title),
);

/** One scenario a template creates, filled from the fit and ready to send to ScenarioApi. */
export type FilledTemplateScenario = {
  name: string;
  situation: string;
  criteria: string[];
  labels: string[];
  kind: ScenarioKind;
  redTeam?: RedTeamConfig;
};

const PLACEHOLDER = /\{\{(agentName|tools|mustNever)\}\}/g;

/** The most characters the tool list fills, so the largest fit keeps attack goals under the cap. */
const TOOLS_TEXT_BUDGET = 1500;

function toolsText({ tools }: { tools: string[] }): string {
  const shown: string[] = [];
  for (const tool of tools) {
    if ([...shown, tool].join(", ").length > TOOLS_TEXT_BUDGET) break;
    shown.push(tool);
  }
  const hidden = tools.length - shown.length;
  return hidden > 0 ? `${shown.join(", ")} and ${hidden} more` : shown.join(", ");
}

function fillText({ text, fit }: { text: string; fit: SuiteTemplateFit }): string {
  return text.replace(PLACEHOLDER, (_, name: string) => {
    if (name === "agentName") return fit.agentName;
    if (name === "tools")
      return fit.tools.length > 0 ? toolsText({ tools: fit.tools }) : "its tools";
    return fit.mustNever.length > 0 ? fit.mustNever.join("; ") : "anything its policy forbids";
  });
}

/** A criterion naming a list the fit left empty says nothing, so it is dropped. */
function keepsCriterion({ text, fit }: { text: string; fit: SuiteTemplateFit }): boolean {
  if (text.includes("{{mustNever}}") && fit.mustNever.length === 0) return false;
  if (text.includes("{{tools}}") && fit.tools.length === 0) return false;
  return true;
}

/** Fills one template scenario: its own criteria, then the template's, without duplicates. */
export function fillTemplateScenario({
  template,
  scenario,
  fit,
}: {
  template: SuiteTemplate;
  scenario: SuiteTemplateScenario;
  fit: SuiteTemplateFit;
}): FilledTemplateScenario {
  const criteria = [
    ...new Set(
      [...scenario.criteria, ...template.criteria]
        .filter((text) => keepsCriterion({ text, fit }))
        .map((text) => fillText({ text, fit })),
    ),
  ];
  const filled: FilledTemplateScenario = {
    name: fillText({ text: scenario.name, fit }),
    situation: fillText({ text: scenario.situation, fit }),
    criteria,
    labels: scenario.labels,
    kind: scenario.attack ? "red_team" : "standard",
  };
  if (scenario.attack) {
    filled.redTeam = {
      attackGoal: fillText({ text: scenario.attack.attackGoal, fit }),
      owaspIds: scenario.attack.owaspIds,
      strategy: scenario.attack.strategy,
      maxTurns: scenario.attack.maxTurns,
    };
  }
  return filled;
}
