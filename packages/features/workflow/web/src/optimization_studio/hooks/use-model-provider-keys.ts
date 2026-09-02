import { useOrganizationTeamProject } from "../../studio-host/use-organization-team-project";

import type {
  Component,
  LLMConfig,
  Signature,
  StudioWorkflow,
} from "@langwatch/workflow-contract";

export const useModelProviderKeys = ({
  workflow,
  extra_llms,
}: {
  workflow: StudioWorkflow;
  extra_llms?: LLMConfig[];
}) => {
  const { modelProviders } = useOrganizationTeamProject();

  const modelProvidersWithoutCustomKeys = Object.values(modelProviders ?? {}).filter(
    (modelProvider: any) => !modelProvider.enabled && !modelProvider.customKeys,
  );

  const nodesWithLLMParameter = workflow.nodes.filter((node) =>
    node.data.parameters?.find((p) => p.type === "llm"),
  );

  const getModelProviders = (nodes: Component[]) => {
    return nodes
      .flatMap((node) =>
        "data" in node && typeof node.data === "object"
          ? (node.data as Signature).parameters
              ?.filter((p) => p.type === "llm")
              .map((p) => (p.value as LLMConfig | undefined)?.model?.split("/")[0])
          : [],
      )
      .filter(
        (provider): provider is string => provider !== undefined && provider !== "",
      );
  };

  const nodeProviders = new Set(getModelProviders(nodesWithLLMParameter as Component[]));

  for (const llm of extra_llms ?? []) {
    const provider = llm.model?.split("/")[0];
    if (provider) {
      nodeProviders.add(provider);
    }
  }

  const uniqueNodeProviders = Array.from(nodeProviders);

  const nodeProvidersWithoutCustomKeys = uniqueNodeProviders.filter((provider) =>
    modelProvidersWithoutCustomKeys.some((p: any) => p.provider === provider),
  );

  const hasProvidersWithoutCustomKeys = nodeProvidersWithoutCustomKeys.length > 0;

  return {
    nodeProvidersWithoutCustomKeys,
    hasProvidersWithoutCustomKeys,
  };
};
