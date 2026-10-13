import {
  workflowDslSchema,
  workflowFieldSchema,
  workflowFieldNodeSchema,
  fieldSchema,
  getMappingSurfaceInputs,
  getWorkflowEndInputs,
  studioWorkflowSchema,
  type WorkflowMappingFields,
  type WorkflowDsl,
  type WorkflowField,
} from "@langwatch/workflow-contract";

type WorkflowDslMetadata = {
  name: string;
  icon?: string | null;
  description?: string | null;
};

export class WorkflowDslService {
  mappingFields(dsl: unknown): WorkflowMappingFields {
    const parsed = studioWorkflowSchema.safeParse(dsl);
    if (!parsed.success) {
      // Historical invalid graphs remain listable, with their unresolved shape explicit.
      return { inputFields: [], outputFields: [], fieldsResolved: false };
    }
    const graph = parsed.data;
    const inputFields = getMappingSurfaceInputs(graph.edges ?? [], graph.nodes).map((input) => ({
      identifier: input.identifier,
      type: input.type,
      ...(input.optional ? { optional: true } : {}),
    }));
    const outputFields = getWorkflowEndInputs(graph).map((output) =>
      fieldSchema.parse({ identifier: output.identifier, type: output.type }),
    );

    return { inputFields, outputFields, fieldsResolved: true };
  }

  static create(): WorkflowDslService {
    return new WorkflowDslService();
  }

  private constructor() {}

  copy(dsl: WorkflowDsl): WorkflowDsl {
    return workflowDslSchema.parse(JSON.parse(JSON.stringify(dsl)));
  }

  metadata(dsl: WorkflowDslMetadata): WorkflowDslMetadata {
    return {
      name: dsl.name,
      ...(dsl.icon !== undefined ? { icon: dsl.icon } : {}),
      ...(dsl.description !== undefined ? { description: dsl.description } : {}),
    };
  }

  evaluatorFields(dsl: WorkflowDsl | undefined): {
    fields: WorkflowField[];
    outputFields: WorkflowField[];
  } {
    const nodes = (dsl?.nodes ?? []).flatMap((node) => {
      const result = workflowFieldNodeSchema.safeParse(node);

      return result.success ? [result.data] : [];
    });
    const entry = nodes.find((node) => node.type === "entry");
    const end = nodes.find((node) => node.type === "end" || node.id === "end");
    const fields = this.fields(entry?.data.outputs);
    const declaredOutputs = this.fields(end?.data.inputs);

    return {
      fields,
      outputFields:
        declaredOutputs.length > 0
          ? declaredOutputs
          : [
              { identifier: "passed", type: "bool" },
              { identifier: "score", type: "float" },
              { identifier: "label", type: "str" },
            ],
    };
  }

  private fields(values: unknown[] | undefined): WorkflowField[] {
    return (values ?? []).flatMap((value) => {
      const result = workflowFieldSchema.safeParse(value);

      return result.success ? [result.data] : [];
    });
  }
}
