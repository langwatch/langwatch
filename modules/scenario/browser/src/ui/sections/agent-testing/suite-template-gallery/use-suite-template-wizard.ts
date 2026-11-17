/**
 * The gallery wizard's state: the step, the chosen template and the fit, reset each time the
 * dialog opens, and the create request built from them.
 * @see modules/scenario/specs/suite-template-gallery.feature
 */

import type { SuiteTemplate, SuiteTemplateFit, SuiteTemplateKind } from "@langwatch/suite-contract";
import { useEffect, useState } from "react";

export type SuiteTemplateCreateRequest = {
  templateId: string;
  fit: SuiteTemplateFit;
  name?: string;
};

export type SuiteTemplateStep = "browse" | "preview" | "fit";

export const AGENT_NAME_REQUIRED = "Name the agent under test.";

function splitLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function withPendingTool({ tools, draft }: { tools: string[]; draft: string }): string[] {
  const tool = draft.trim().replace(/,$/, "").trim();
  return tool && !tools.includes(tool) ? [...tools, tool] : tools;
}

export function useSuiteTemplateWizard({
  open,
  isCreating,
  onCreate,
}: {
  open: boolean;
  isCreating: boolean;
  onCreate: (request: SuiteTemplateCreateRequest) => void;
}) {
  const [tab, setTab] = useState<SuiteTemplateKind>("archetype");
  const [step, setStep] = useState<SuiteTemplateStep>("browse");
  const [chosen, setChosen] = useState<SuiteTemplate | null>(null);
  const [agentName, setAgentName] = useState("");
  const [tools, setTools] = useState<string[]>([]);
  const [toolDraft, setToolDraft] = useState("");
  const [mustNever, setMustNever] = useState("");
  const [suiteName, setSuiteName] = useState("");
  const [agentNameProblem, setAgentNameProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep("browse");
    setChosen(null);
    setAgentName("");
    setTools([]);
    setToolDraft("");
    setMustNever("");
    setSuiteName("");
    setAgentNameProblem(null);
  }, [open]);

  const submit = () => {
    if (!chosen || isCreating) return;
    const name = agentName.trim();
    if (!name) {
      setAgentNameProblem(AGENT_NAME_REQUIRED);
      return;
    }
    setAgentNameProblem(null);
    onCreate({
      templateId: chosen.id,
      fit: {
        agentName: name,
        tools: withPendingTool({ tools, draft: toolDraft }),
        mustNever: splitLines(mustNever),
      },
      ...(suiteName.trim() ? { name: suiteName.trim() } : {}),
    });
  };

  return {
    tab,
    setTab,
    step,
    setStep,
    chosen,
    choose: (template: SuiteTemplate) => {
      setChosen(template);
      setStep("preview");
    },
    agentName,
    setAgentName,
    tools,
    removeTool: (tool: string) => setTools(tools.filter((other) => other !== tool)),
    toolDraft,
    setToolDraft,
    addTool: () => {
      setTools(withPendingTool({ tools, draft: toolDraft }));
      setToolDraft("");
    },
    mustNever,
    setMustNever,
    suiteName,
    setSuiteName,
    agentNameProblem,
    submit,
  };
}

export type SuiteTemplateWizard = ReturnType<typeof useSuiteTemplateWizard>;
