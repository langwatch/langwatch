/**
 * Puts the organization's private endpoint bindings (ADR-203) on every engine run, signed, in the
 * header the engine transports merge from `privateEndpointsHeaders`; nlpgo never reads the body.
 * @see specs/security/org-private-model-endpoints.feature
 */
import {
  type ModelProviderApi,
  PRIVATE_ENDPOINTS_FIELD,
  type PrivateEndpointsHeaders,
} from "@langwatch/model-provider-contract";

import type { WorkflowNlpRuntime } from "../app/workflow.app.ts";
import type { WorkflowStudioStream } from "../channels/nlp-lambda.channel.ts";

type PrivateEndpointBindings = Pick<ModelProviderApi, "privateEndpointsHeadersForProject">;

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
      open: async (input) => {
        const body = withoutSentBindings(input.body);
        return inner.open({
          ...input,
          body,
          privateEndpointsHeaders: await this.headersFor(input.projectId, body),
        });
      },
    };
  }

  /**
   * The synchronous route, with the organization's bindings on every run it dispatches. This is
   * also the relay a scenario child's turn takes, whose body the app forwards unread.
   */
  boundRuntime(inner: WorkflowNlpRuntime): WorkflowNlpRuntime {
    return {
      dispatch: async (input) => {
        const body = withoutSentBindings(input.body);
        return inner.dispatch({
          ...input,
          body,
          privateEndpointsHeaders: await this.headersFor(input.projectId, body),
        });
      },
    };
  }

  /**
   * The organization's bindings, signed for this project; whatever the caller put on the input is
   * replaced. An event that runs no graph (`is_alive`, `stop_execution`) gets none. nlpgo checks
   * the envelope on arrival, so the default expiry covers staging and a cold Lambda, not the run.
   */
  private async headersFor(projectId: string, body: object): Promise<PrivateEndpointsHeaders> {
    if (!runsGraph(body)) return {};
    return this.modelProviders.privateEndpointsHeadersForProject({ projectId });
  }
}

/** Whether the event carries a graph, in the discriminated envelope or the flat one. */
function runsGraph(body: object): boolean {
  if ("workflow" in body) return true;
  const payload: unknown = "payload" in body ? body.payload : undefined;
  return typeof payload === "object" && payload !== null && "workflow" in payload;
}

/**
 * The event without a sender's `private_endpoints` field where older engine builds read it: the
 * top level and `payload`. nlpgo no longer reads the body, so this is defence in depth. A deeper
 * key of that name is tenant data (a dataset row, an input, a node parameter) and passes as sent.
 */
function withoutSentBindings<Body extends object>(body: Body): Body {
  const top = withoutField(body);
  if (!("payload" in top) || !isRecord(top.payload)) return top;
  const payload = withoutField(top.payload);
  return payload === top.payload ? top : { ...top, payload };
}

function withoutField<Value extends object>(value: Value): Value {
  if (!(PRIVATE_ENDPOINTS_FIELD in value)) return value;
  const { [PRIVATE_ENDPOINTS_FIELD]: _sent, ...rest } = value as Record<string, unknown>;
  return rest as Value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
