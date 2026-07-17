import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import type { TargetConfig } from "../types";

type TargetOutputs = TargetConfig["outputs"];

/**
 * The output fields a target actually produces, preferring the target's own
 * copy but falling back to the saved prompt's.
 *
 * A workbench target carries a COPY of its prompt's output fields. Until
 * recently the code that wrote that copy mapped it down to `{identifier, type}`
 * and dropped `json_schema` — so every target saved before that fix has a
 * `json_schema` output with no schema attached. The comparison config derives
 * its per-variant field picker from that schema, so those variants silently
 * offer no fields to pick, and the only way to recover was to remove and re-add
 * the variant.
 *
 * Reading through to the prompt fixes that for already-saved comparisons
 * instead of only for newly-added ones. The prompt is the source of truth for
 * its own outputs anyway; the target's copy exists so validation works without
 * a fetch.
 *
 * Uses the same query key as useTargetName, so the prompt is already in cache
 * and this costs no extra request.
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
          enabled:
            target?.type === "prompt" && !!target.promptId && !!projectId,
          staleTime: 60_000,
        },
      ),
    ),
  );

  return targets.map((target, index) => {
    if (!target) return undefined;

    const own = target.outputs;
    // Only reach for the prompt when the target's own copy is missing a schema
    // it claims to have — a plain text output needs nothing more.
    const needsSchema = (own ?? []).some(
      (field) => field.type === "json_schema" && !field.json_schema,
    );
    if (own && own.length > 0 && !needsSchema) return own;

    // Undefined — NOT the schema-less copy — while the prompt is in flight.
    // Handing back `own` here would advertise a lone "output" field whose path
    // is `["output"]`, and the backend unwraps a single "output" before walking
    // the object, so that path resolves to nothing and the judge silently
    // compares an empty candidate. A user clicking during the flash would
    // persist exactly that. Callers render an unresolved picker instead.
    if (promptQueries[index]?.isLoading) return undefined;

    const promptOutputs = (
      promptQueries[index]?.data as { outputs?: TargetOutputs } | undefined
    )?.outputs;

    // needsSchema means `own` is the known-invalid schema-less copy — if the
    // prompt lookup came back empty (deleted prompt, fetch error), returning
    // `own` here would silently restore that exact invalid value instead of
    // surfacing the unresolved state to the caller.
    return needsSchema ? promptOutputs : (promptOutputs ?? own);
  });
};
