import { merge } from "lodash-es";

import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { Component } from "~/optimization_studio/types/dsl";
import { MODULES } from "~/optimization_studio/registry";
import type { NodeWithOptionalPosition } from "~/types";
import { api } from "~/utils/api";
import { DEFAULT_MODEL } from "~/utils/constants";

import { NodeDraggable } from "./NodeDraggable";

type LlmSignatureNodeDraggableProps = {
  onDragEnd?: (item: { node: NodeWithOptionalPosition<Component> }) => void;
};

export function LlmSignatureNodeDraggable({
  onDragEnd,
}: LlmSignatureNodeDraggableProps) {
  const { project } = useOrganizationTeamProject();

  // Nodes own their LLM config: seed freshly dragged nodes with the
  // project's cascade-resolved default, or the registry flagship when
  // nothing is configured (query still loading falls back the same way —
  // the value is materialized again server-side on save).
  const resolvedDefault = api.modelProvider.getResolvedDefault.useQuery(
    { projectId: project?.id ?? "", featureKey: "workflows.create_default" },
    { enabled: !!project?.id },
  );

  return (
    <NodeDraggable
      component={merge({}, MODULES.signature, {
        parameters: [
          {
            identifier: "llm",
            type: "llm",
            value: { model: resolvedDefault.data?.model ?? DEFAULT_MODEL },
          },
        ],
      })}
      type="signature"
      onDragEnd={onDragEnd}
    />
  );
}
