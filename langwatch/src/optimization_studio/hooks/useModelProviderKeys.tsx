import { useWorkflowStore } from "../hooks/useWorkflowStore";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";

import type { Component, LLMConfig, Signature } from "../types/dsl";

export const useModelProviderKeys = (extra_llms?: LLMConfig[]) => {
  const { modelProviders } = useOrganizationTeamProject();
  const { getWorkflow, nodes } = useWorkflowStore((state) => ({
    getWorkflow: state.getWorkflow,
    nodes: state.nodes,
  }));

  const workflow = getWorkflow();

  const modelProvidersWithoutCustomKeys = Object.values(
    modelProviders ?? {}
  ).filter((modelProvider) => !modelProvider.customKeys);

  const nodesWithCustomLLM = nodes.filter(
    (node) =>
      (node.data as Signature).parameters?.find(
        (p) => p.identifier === "llm" && p.value
      )
  );

  const getModelProviders = (nodes: Component[]) => {
    return nodes
      .map((node) =>
        "data" in node &&
        typeof node.data === "object" &&
        node.data !== null &&
        "llm" in node.data
          ? (
              (node.data as Signature).parameters?.find(
                (p) => p.identifier === "llm" && p.value
              )?.value as LLMConfig
            ).model.split("/")[0]
          : undefined
      )
      .filter((provider): provider is string => provider !== undefined);
  };

  const nodeProviders = new Set(
    getModelProviders(nodesWithCustomLLM as Component[])
  );

  const defaultModel = workflow.default_llm.model.split("/")[0];
  if (defaultModel && !nodeProviders.has(defaultModel)) {
    nodeProviders.add(defaultModel);
  }

  for (const llm of extra_llms ?? []) {
    const provider = llm.model.split("/")[0];
    if (provider) {
      nodeProviders.add(provider);
    }
  }

  const uniqueNodeProviders = Array.from(nodeProviders);

  const nodeProvidersWithoutCustomKeys = uniqueNodeProviders.filter(
    (provider) =>
      modelProvidersWithoutCustomKeys.some((p) => p.provider === provider)
  );

  const hasProvidersWithoutCustomKeys =
    nodeProvidersWithoutCustomKeys.length > 0;

  return {
    nodeProvidersWithoutCustomKeys,
    hasProvidersWithoutCustomKeys,
  };
};
