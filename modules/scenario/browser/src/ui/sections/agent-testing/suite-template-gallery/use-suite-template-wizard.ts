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

function useSuiteTemplateFit({ open }: { open: boolean }) {
  const [agentName, setAgentName] = useState("");
  const [tools, setTools] = useState<string[]>([]);
  const [toolDraft, setToolDraft] = useState("");
  const [mustNever, setMustNever] = useState("");
  const [suiteName, setSuiteName] = useState("");
  const [agentNameProblem, setAgentNameProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setAgentName("");
    setTools([]);
    setToolDraft("");
    setMustNever("");
    setSuiteName("");
    setAgentNameProblem(null);
  }, [open]);

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
  };
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
  const { toRequest, ...fit } = useSuiteTemplateFit({ open });

  useEffect(() => {
    if (!open) return;
    setStep("browse");
    setChosen(null);
  }, [open]);

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
      setChosen(template);
      setStep("preview");
    },
    ...fit,
    submit,
  };
}

export type SuiteTemplateWizard = ReturnType<typeof useSuiteTemplateWizard>;
