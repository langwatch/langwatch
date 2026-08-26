import type { Node, NodeProps } from "@xyflow/react";

import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { workflowApi } from "../../utils/workflow-api";
import type { Custom } from "@langwatch/workflow-contract";

export const useComponentVersion = (node: NodeProps<Node<Custom>> | Node<Custom>) => {
  const { project } = useOrganizationTeamProject();

  if (!node) {
    return { version: null, latestVersion: null };
  }

  const componentsVersionId = node.data.version_id;

  const getVersions = workflowApi.workflow.getVersions.useQuery(
    {
      projectId: project?.id ?? "",
      workflowId: node.data.workflow_id ?? "",
      returnDSL: true,
    },
    {
      enabled: !!project?.id && !!node.data.workflow_id,
    },
  );

  const currentVersion = getVersions.data?.find(
    (v) => String(v.id).trim() === String(componentsVersionId).trim(),
  );

  const publishedVersion = getVersions.data?.find((v) => v.isPublishedVersion === true);

  if (!currentVersion || !project) {
    return { currentVersion: null, publishedVersion: null };
  }
  return { currentVersion, publishedVersion };
};
