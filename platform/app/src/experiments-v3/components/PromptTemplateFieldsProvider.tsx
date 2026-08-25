import { type ReactNode, useCallback, useMemo } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useEvaluationsV3Store } from "../hooks/useEvaluationsV3Store";
import { PromptTemplateFieldsContext } from "../hooks/usePromptTemplateFields";
import type { TargetConfig } from "../types";
import { getFieldsUsedByPromptTemplate } from "../utils/mappingValidation";

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
        { idOrHandle: target.promptId ?? "", projectId },
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
      const prompt = promptQueries[index]?.data;
      if (!prompt) return;
      // Only the version the target actually runs describes its template.
      if (
        target.promptVersionNumber !== undefined &&
        target.promptVersionNumber !== prompt.version
      ) {
        return;
      }

      byTargetId.set(
        target.id,
        getFieldsUsedByPromptTemplate({
          messages: prompt.messages,
          declaredFieldIds: (target.inputs ?? []).map(
            (input) => input.identifier,
          ),
        }),
      );
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
