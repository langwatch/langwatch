import { useWorkflowStore } from "../hooks/useWorkflowStore";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";

import type { Component, Field, LLMConfig, Signature } from "../types/dsl";

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

  const defaultModelProvider = workflow.default_llm.model.split("/")[0];

  const nodesWithLLMParameter = nodes.filter(
    (node) => node.data.parameters?.find((p) => p.type === "llm")
  );

  const getModelProviders = (nodes: Component[]) => {
    return nodes
      .flatMap((node) =>
        "data" in node && typeof node.data === "object"
          ? (node.data as Signature).parameters
              ?.filter((p) => p.type === "llm")
              .map(
                (p) =>
                  (p.value as LLMConfig | undefined)?.model.split("/")[0] ??
                  defaultModelProvider
              )
          : []
      )
      .filter((provider): provider is string => provider !== undefined);
  };

  const nodeProviders = new Set(
    getModelProviders(nodesWithLLMParameter as Component[])
  );

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
