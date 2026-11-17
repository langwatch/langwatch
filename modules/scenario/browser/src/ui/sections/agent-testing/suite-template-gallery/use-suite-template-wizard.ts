/**
 * The gallery wizard's state: the step, the chosen template and the fit, and the create request
 * built from them. The gallery mounts only while open, so each opening starts from fresh state.
 * @see modules/scenario/specs/suite-template-gallery.feature
 */

import type { SuiteTemplate, SuiteTemplateFit, SuiteTemplateKind } from "@langwatch/suite-contract";
import { useState } from "react";

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

function useSuiteTemplateFit() {
  const [agentName, setAgentName] = useState("");
  const [tools, setTools] = useState<string[]>([]);
  const [toolDraft, setToolDraft] = useState("");
  const [mustNever, setMustNever] = useState("");
  const [suiteName, setSuiteName] = useState("");
  const [agentNameProblem, setAgentNameProblem] = useState<string | null>(null);

  /** The create fields for a template, or null after flagging a missing agent name. */
  const toRequest = (templateId: string): SuiteTemplateCreateRequest | null => {
    const name = agentName.trim();
    if (!name) {
      setAgentNameProblem(AGENT_NAME_REQUIRED);
      return null;
    }
    setAgentNameProblem(null);
    return {
      templateId,
      fit: {
        agentName: name,
        tools: withPendingTool({ tools, draft: toolDraft }),
        mustNever: splitLines(mustNever),
      },
      ...(suiteName.trim() ? { name: suiteName.trim() } : {}),
    };
  };

  return {
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
    toRequest,
    /** A new template starts with no suite name of its own and no stale error. */
    resetForTemplate: () => {
      setSuiteName("");
      setAgentNameProblem(null);
    },
  };
}

export function useSuiteTemplateWizard({
  isCreating,
  onCreate,
}: {
  isCreating: boolean;
  onCreate: (request: SuiteTemplateCreateRequest) => void;
}) {
  const [tab, setTab] = useState<SuiteTemplateKind>("archetype");
  const [step, setStep] = useState<SuiteTemplateStep>("browse");
  const [chosen, setChosen] = useState<SuiteTemplate | null>(null);
  const { toRequest, resetForTemplate, ...fit } = useSuiteTemplateFit();

  const submit = () => {
    if (!chosen || isCreating) return;
    const request = toRequest(chosen.id);
    if (request) onCreate(request);
  };

  return {
    tab,
    setTab,
    step,
    setStep,
    chosen,
    choose: (template: SuiteTemplate) => {
      if (template.id !== chosen?.id) resetForTemplate();
      setChosen(template);
      setStep("preview");
    },
    ...fit,
    submit,
  };
}

export type SuiteTemplateWizard = ReturnType<typeof useSuiteTemplateWizard>;
