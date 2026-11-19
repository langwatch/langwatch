/**
 * Tells the engine which hostnames the project's organization bound to its private model
 * endpoints (ADR-203). nlpgo pins the workflow's LLM and evaluator blocks to them; HTTP blocks
 * never read the field. @see specs/security/org-private-model-endpoints.feature
 */
import {
  type ModelProviderApi,
  PRIVATE_ENDPOINTS_FIELD,
  privateEndpointsField,
} from "@langwatch/model-provider-contract";

import type { WorkflowNlpRuntime } from "../app/workflow.app.ts";
import type { WorkflowStudioStream } from "../channels/nlp-lambda.channel.ts";

type PrivateEndpointBindings = Pick<ModelProviderApi, "privateEndpointBindingsForProject">;

export class WorkflowEnginePrivateEndpointsService {
  static create(deps: {
    modelProviders: PrivateEndpointBindings;
  }): WorkflowEnginePrivateEndpointsService {
    return new WorkflowEnginePrivateEndpointsService(deps.modelProviders);
  }

  private constructor(private readonly modelProviders: PrivateEndpointBindings) {}

  /** The streaming route, with the organization's bindings on every run it opens. */
  boundStream(inner: WorkflowStudioStream): WorkflowStudioStream {
    return {
      open: async (input) =>
        inner.open({ ...input, body: await this.stamp(input.projectId, input.body) }),
    };
  }

  /** The synchronous route, with the organization's bindings on every run it dispatches. */
  boundRuntime(inner: WorkflowNlpRuntime): WorkflowNlpRuntime {
    return {
      dispatch: async (input) =>
        inner.dispatch({ ...input, body: await this.stamp(input.projectId, input.body) }),
    };
  }

  /**
   * The event with the bindings in its payload, only when it carries a graph and the
   * organization bound something. A sender's own `private_endpoints` never survives: the field
   * is the platform's to set, so it is dropped before the organization's is added.
   */
  private async stamp<Body extends object>(projectId: string, body: Body): Promise<Body> {
    const payload: unknown = "payload" in body ? body.payload : undefined;
    if (typeof payload !== "object" || payload === null || !("workflow" in payload)) return body;

    const bindings = await this.modelProviders.privateEndpointBindingsForProject({ projectId });
    const { [PRIVATE_ENDPOINTS_FIELD]: _sent, ...rest } = payload as Record<string, unknown>;
    const { [PRIVATE_ENDPOINTS_FIELD]: _envelope, ...envelope } = body as Record<string, unknown>;

    return { ...envelope, payload: { ...rest, ...privateEndpointsField(bindings) } } as Body;
  }
}
