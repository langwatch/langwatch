import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";

import type { Component, LLMConfig, Signature, Workflow } from "../types/dsl";

export const useModelProviderKeys = ({
  workflow,
  extra_llms,
}: {
  workflow: Workflow;
  extra_llms?: LLMConfig[];
}) => {
  const { modelProviders } = useOrganizationTeamProject();

  const modelProvidersWithoutCustomKeys = Object.values(
    modelProviders ?? {}
  ).filter((modelProvider) => !modelProvider.customKeys);

  const defaultModelProvider = workflow.default_llm.model.split("/")[0];

  const nodesWithLLMParameter = workflow.nodes.filter(
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
