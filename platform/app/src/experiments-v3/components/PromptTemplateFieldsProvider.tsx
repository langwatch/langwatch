import { type ReactNode, useCallback, useMemo } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useEvaluationsV3Store } from "../hooks/useEvaluationsV3Store";
import { PromptTemplateFieldsContext } from "../hooks/usePromptTemplateFields";
import type { TargetConfig } from "../types";
import {
  getFieldsUsedByPromptTemplate,
  type PromptTemplateMessage,
} from "../utils/mappingValidation";

/** What one resolved prompt query answers with, of the parts read here. */
type ResolvedPrompt = {
  version?: number;
  messages: PromptTemplateMessage[];
};

/**
 * The variables one column's template really consumes.
 *
 * Undefined when the answer is not the template this column runs: the query
 * asks for the pinned version, so a version mismatch means describing the
 * column from the wrong template, which is worse than describing nothing.
 */
const fieldsUsedByTarget = ({
  target,
  prompt,
}: {
  target: TargetConfig;
  prompt: ResolvedPrompt | null | undefined;
}): Set<string> | undefined => {
  if (!prompt) return undefined;
  if (
    target.promptVersionNumber !== undefined &&
    target.promptVersionNumber !== prompt.version
  ) {
    return undefined;
  }
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
export const PromptTemplateFieldsProvider = ({
  children,
}: {
  children: ReactNode;
}) => {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";
  const targets = useEvaluationsV3Store((state) => state.targets);

  const promptTargets = useMemo(
    () =>
      targets.filter(
        (target) =>
          target.type === "prompt" &&
          !!target.promptId &&
          !target.localPromptConfig,
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
          ...(target.promptVersionNumber !== undefined
            ? { version: target.promptVersionNumber }
            : {}),
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
