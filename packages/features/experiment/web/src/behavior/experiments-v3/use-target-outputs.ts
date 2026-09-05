import { useOrganizationTeamProject } from "@langwatch/ui-host/use-organization-team-project";
import { api } from "@langwatch/workflow-web/studio-host/api";
import type { TargetConfig } from "../../model/experiments-v3/types";

type TargetOutputs = TargetConfig["outputs"];

/**
 * The output fields a target actually produces, preferring an unsaved local draft, then
 * the target's own copy, then falling back to the saved prompt's.
 */
export const useTargetOutputs = (
  targets: (TargetConfig | undefined)[],
): (TargetOutputs | undefined)[] => {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";

  const promptQueries = api.useQueries((t) =>
    targets.map((target) =>
      t.prompts.getByIdOrHandle(
        { idOrHandle: target?.promptId ?? "", projectId },
        {
          enabled: target?.type === "prompt" && !!target.promptId && !!projectId,
          staleTime: 60_000,
        },
      ),
    ),
  );

  return targets.map((target, index) => {
    if (!target) return undefined;

    const draft = target.localPromptConfig?.outputs as TargetOutputs | undefined;
    const draftNeedsSchema = (draft ?? []).some(
      (field) => field.type === "json_schema" && !field.json_schema,
    );
    if (draft && draft.length > 0 && !draftNeedsSchema) return draft;

    const own = target.outputs;
    // Only reach for the prompt when the target's own copy is missing a schema
    // it claims to have — a plain text output needs nothing more.
    const needsSchema = (own ?? []).some(
      (field) => field.type === "json_schema" && !field.json_schema,
    );
    if (own && own.length > 0 && !needsSchema) return own;

    // Undefined — NOT the schema-less copy — while the prompt is in flight.
    if (promptQueries[index]?.isLoading) return undefined;

    const promptOutputs = (promptQueries[index]?.data as { outputs?: TargetOutputs } | undefined)
      ?.outputs;

    // needsSchema means `own` is the known-invalid schema-less copy — if the
    // prompt lookup came back empty (deleted prompt, fetch error), returning
    // `own` here would silently restore that exact invalid value instead of
    // surfacing the unresolved state to the caller.
    return needsSchema ? promptOutputs : (promptOutputs ?? own);
  });
};
