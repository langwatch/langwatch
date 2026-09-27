/** Workflow's code editor from its kit, wired with this project's secret names. */

import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import { api } from "@langwatch/browser-trpc/workflow-api";
import { WorkflowCodeEditor } from "@langwatch/workflow-browser-kit";
import { type ComponentProps, useMemo } from "react";

type EvaluatorCodeEditorProps = Omit<
  ComponentProps<typeof WorkflowCodeEditor>,
  "projectId" | "secretNames"
>;

export function EvaluatorCodeEditor(props: EvaluatorCodeEditorProps) {
  const { project } = useOrganizationTeamProject();
  const secrets = api.secrets.list.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: Boolean(project?.id) },
  );
  const secretNames = useMemo(
    () => (secrets.data ?? []).map((secret) => secret.name),
    [secrets.data],
  );
  return <WorkflowCodeEditor {...props} projectId={project?.id} secretNames={secretNames} />;
}
