import type {
  Component,
  Field,
  StudioEdge,
  StudioNode,
  StudioPosition,
} from "./studio-workflow";

const camelCaseToSnakeCase = (value: string) =>
  value.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();

export type NodeWithOptionalPosition<T extends Component = Component> = Omit<
  StudioNode<T>,
  "position"
> & { position?: StudioPosition };

/**
 * Validates a node name for rename operations.
 * Returns `{ valid: true }` or `{ valid: false, error: string }`.
 */
export const validateNodeName = ({
  name,
  currentNodeId,
  existingNodeIds,
}: {
  name: string;
  currentNodeId: string;
  existingNodeIds: string[];
}): { valid: true } | { valid: false; error: string } => {
  const trimmed = name.trim();
  if (!trimmed) {
    return { valid: false, error: "Name cannot be empty" };
  }

  const withUnderscores = trimmed.replace(/ /g, "_");

  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(withUnderscores)) {
    return { valid: false, error: "Name must be a valid Python identifier" };
  }

  const newId = nameToId(trimmed);
  if (existingNodeIds.some((id) => id !== currentNodeId && id === newId)) {
    return { valid: false, error: "A node with this name already exists" };
  }

  return { valid: true };
};

export const nameToId = (name: string) => {
  return camelCaseToSnakeCase(name)
    .replace(/[()]/g, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Remove combining diacritical marks
    .replace(/[^a-zA-Z0-9_]/g, "_");
};

export const findLowestAvailableName = (nodesIds: string[], prefix: string) => {
  const findNode = (id: string) => {
    return nodesIds.find((nodeId) => nodeId === id);
  };

  let i = 1;
  let name;
  let id;
  do {
    if (i === 1) {
      name = prefix;
    } else {
      name = `${prefix} (${i})`;
    }
    id = nameToId(name);
    i++;
  } while (findNode(id));

  return { name, id };
};

export const getEntryInputs = (
  edges: StudioEdge[],
  nodes: StudioNode[],
): (StudioEdge & { optional?: boolean })[] => {
  const entryEdges = edges.filter((edge) => edge.source === "entry");
  const evaluators = nodes.filter(checkIsEvaluator);

  const entryInputs = entryEdges
    .filter(
      (edge, index, self) =>
        self.findIndex((e) => e.sourceHandle === edge.sourceHandle) === index,
    )
    .map((edge) => {
      if (!evaluators?.some((evaluator) => evaluator.id === edge.target)) {
        return edge;
      }
      return {
        ...edge,
        optional: true,
      };
    });

  return entryInputs;
};

/**
 * Returns the set of entry-node fields that should appear on the scenario
 * mapping surface — one row per declared entry output, with the optional flag
 * set when there is at least one downstream edge AND every such edge targets
 * an evaluator node.
 *
 * Unwired declared outputs (no downstream edges at all) are included without
 * the optional flag: they are real workflow inputs that simply have not been
 * connected yet.
 *
 * Falls back to `getEntryInputs` when the entry node is absent or declares no
 * outputs — fallback for legacy DSLs without a declared entry node, should be
 * unreachable for current schemas.
 */
export const getMappingSurfaceInputs = (
  edges: StudioEdge[],
  nodes: StudioNode[],
): Array<{
  identifier: string;
  type: Field["type"];
  optional?: boolean;
}> => {
  const entryNode = nodes.find((node) => node.type === "entry" || node.id === "entry");
  const declaredOutputs: Array<Pick<Field, "identifier" | "type">> = Array.isArray(
    entryNode?.data?.outputs,
  )
    ? entryNode.data.outputs
    : [];

  if (declaredOutputs.length === 0) {
    // fallback for legacy DSLs without a declared entry node — should be unreachable for current schemas
    return getEntryInputs(edges, nodes).map((edge) => ({
      identifier: edge.sourceHandle?.split(".")[1] ?? "",
      type: "str" as Field["type"],
      ...(edge.optional ? { optional: true } : {}),
    }));
  }

  const evaluators = nodes.filter(checkIsEvaluator);
  const evaluatorIds = new Set(evaluators.map((e) => e.id));

  return declaredOutputs.map(({ identifier, type }) => {
    const fieldEdges = edges.filter(
      (edge) => edge.source === "entry" && edge.sourceHandle === `outputs.${identifier}`,
    );

    const hasNonEvaluatorTarget = fieldEdges.some(
      (edge) => !evaluatorIds.has(edge.target),
    );

    const evaluatorOnly = fieldEdges.length > 0 && !hasNonEvaluatorTarget;

    return {
      identifier,
      type: (typeof type === "string" ? type : "str") as Field["type"],
      ...(evaluatorOnly ? { optional: true } : {}),
    };
  });
};

export const getInputsOutputs = (edges: StudioEdge[], nodes: StudioNode[]) => {
  const entryInputs = getEntryInputs(edges, nodes);

  const inputs = entryInputs.map((edge) => ({
    identifier: edge.sourceHandle?.split(".")[1],
    type: "str",
    ...(edge.optional ? { optional: true } : {}),
  }));

  const outputs = nodes.find((node) => node.type === "end" || node.id === "end")?.data
    .inputs;

  return { inputs, outputs };
};

export const checkIsEvaluator = (node: StudioNode) => {
  return node.type === "evaluator" || node.data.behave_as === "evaluator";
};
