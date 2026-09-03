import { type ReactNode, useCallback, useMemo } from "react";
import { useOrganizationTeamProject } from "@langwatch/workflow-web/studio-host/use-organization-team-project";
import { api } from "@langwatch/workflow-web/studio-host/api";
import { useEvaluationsV3Store } from "../../../behavior/experiments-v3/use-evaluations-v3-store";
import { PromptTemplateFieldsContext } from "../../../behavior/experiments-v3/use-prompt-template-fields";
import type { TargetConfig } from "../../../model/experiments-v3/types";
import {
  getFieldsUsedByPromptTemplate,
  type PromptTemplateMessage,
} from "../../../model/experiments-v3/mapping-validation";

/** What one resolved prompt query answers with, of the parts read here. */
type ResolvedPrompt = {
  version?: number;
  versionId?: string;
  messages: PromptTemplateMessage[];
};

/**
 * Which version one column pins to, in the order the execution request reads
 * them: the version id is the exact row, the number is the same row addressed
 * by its place in the prompt's history.
 */
const versionSelectorOf = (target: TargetConfig): { versionId?: string; version?: number } => {
  if (target.promptVersionId !== undefined) {
    return { versionId: target.promptVersionId };
  }
  if (target.promptVersionNumber !== undefined) {
    return { version: target.promptVersionNumber };
  }
  return {};
};

/** Whether an answer is the version the column pinned to. */
const isThePinnedVersion = ({
  target,
  prompt,
}: {
  target: TargetConfig;
  prompt: ResolvedPrompt;
}): boolean => {
  if (target.promptVersionId !== undefined) {
    return prompt.versionId === target.promptVersionId;
  }
  if (target.promptVersionNumber !== undefined) {
    return prompt.version === target.promptVersionNumber;
  }
  return true;
};

/**
 * The variables one column's template really consumes.
 *
 * Undefined when the answer is not the template this column runs: the query
 * asks for the pinned version, so a mismatch means describing the column from
 * the wrong template, which is worse than describing nothing.
 */
const fieldsUsedByTarget = ({
  target,
  prompt,
}: {
  target: TargetConfig;
  prompt: ResolvedPrompt | null | undefined;
}): Set<string> | undefined => {
  if (!prompt) return undefined;
  if (!isThePinnedVersion({ target, prompt })) return undefined;
  return getFieldsUsedByPromptTemplate({
    messages: prompt.messages,
    declaredFieldIds: (target.inputs ?? []).map((input) => input.identifier),
  });
};

/**
 * Resolves the variables every prompt target's saved template consumes and
 * publishes them to mapping validation, so a column warns about a variable the
 * prompt really uses and stays quiet about one it only declares.
 *
 * The queries reuse the key the column headers already read for the prompt
 * name and the version badge, so they come from the react-query cache. A
 * target pinned to a version other than the one loaded here resolves to
 * nothing, and validation then requires no mapping of it.
 */
export const PromptTemplateFieldsProvider = ({ children }: { children: ReactNode }) => {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";
  const targets = useEvaluationsV3Store((state) => state.targets);

  const promptTargets = useMemo(
    () =>
      targets.filter(
        (target) => target.type === "prompt" && !!target.promptId && !target.localPromptConfig,
      ),
    [targets],
  );

  const promptQueries = api.useQueries((t) =>
    promptTargets.map((target) =>
      t.prompts.getByIdOrHandle(
        {
          idOrHandle: target.promptId ?? "",
          projectId,
          // A pinned column runs the version it names, and the template that
          // decides which variables are required is that version's. Asking for
          // the latest and dropping it when it disagrees left the column with
          // no required fields at all, which reads as "nothing to map".
          ...versionSelectorOf(target),
        },
        {
          enabled: !!target.promptId && !!projectId,
          staleTime: 60_000,
          refetchOnWindowFocus: false,
        },
      ),
    ),
  );

  // api.useQueries returns a new array every render, so key the memo on the
  // resolved versions and declared inputs rather than on the query objects.
  const resolvedSignature = JSON.stringify(
    promptTargets.map((target, index) => [
      target.id,
      target.promptVersionId ?? null,
      target.promptVersionNumber ?? null,
      promptQueries[index]?.data?.versionId ?? null,
      (target.inputs ?? []).map((input) => input.identifier),
    ]),
  );

  const fieldsByTargetId = useMemo(() => {
    const byTargetId = new Map<string, Set<string>>();
    promptTargets.forEach((target, index) => {
      const fields = fieldsUsedByTarget({
        target,
        prompt: promptQueries[index]?.data,
      });
      if (fields) byTargetId.set(target.id, fields);
    });
    return byTargetId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedSignature]);

  const lookup = useCallback(
    (target: TargetConfig) => fieldsByTargetId.get(target.id),
    [fieldsByTargetId],
  );

  return (
    <PromptTemplateFieldsContext.Provider value={lookup}>
      {children}
    </PromptTemplateFieldsContext.Provider>
  );
};
