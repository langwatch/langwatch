/**
 * The engine's STREAMING studio route, reached over HTTP.
 *
 * This is the wire half of the platform app's `studioBackendPostEvent`: one
 * POST to `/go/studio/execute` tagged `X-LangWatch-Origin`, whose response body
 * is a server-sent event stream the caller reads until the engine says `done`.
 *
 * What did NOT come with it is the per-project Lambda routing and the S3
 * payload staging the platform app wrapped it in. That machinery is the
 * deployment's rather than the feature's, and a process that has only a service
 * URL is a supported shape rather than a degraded one — it is what every
 * self-hosted install and every local stack already runs.
 */
import { WorkflowStudioStreamPort, type WorkflowStudioStreamInput } from "../ports/workflow.port";

/** The engine's streaming studio route at a single configured address. */
export class HttpWorkflowStudioStreamAdapter extends WorkflowStudioStreamPort {
  static create(options: {
    /** Where the engine answers, for example `http://127.0.0.1:5561`. */
    serviceUrl: string;
    /** Injected so a test drives the wire without a listener. */
    fetch?: typeof fetch;
  }): HttpWorkflowStudioStreamAdapter {
    return new HttpWorkflowStudioStreamAdapter(options);
  }

  private constructor(private readonly options: { serviceUrl: string; fetch?: typeof fetch }) {
    super();
  }

  async open(input: WorkflowStudioStreamInput): Promise<ReadableStreamDefaultReader<Uint8Array>> {
    const call = this.options.fetch ?? fetch;
    const response = await call(`${this.options.serviceUrl.replace(/\/$/, "")}/go/studio/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-LangWatch-Origin": input.origin,
      },
      body: JSON.stringify(input.body),
    });

    const body = response.body;
    if (!body) {
      throw new Error("No response body");
    }
    return body.getReader();
  }
}

/**
 * The engine this deployment did not configure.
 *
 * Refuses by name rather than answering: a studio run dispatched at no address
 * is not a slower run, it is one whose result nobody will ever see, and a
 * `fetch` at `undefined/go/...` reports a URL parse failure instead of the
 * configuration gap that caused it.
 */
export class UnconfiguredWorkflowStudioStreamAdapter extends WorkflowStudioStreamPort {
  static create(): UnconfiguredWorkflowStudioStreamAdapter {
    return new UnconfiguredWorkflowStudioStreamAdapter();
  }

  private constructor() {
    super();
  }

  open(): Promise<ReadableStreamDefaultReader<Uint8Array>> {
    return Promise.reject(
      new Error(
        "This process was composed without an NLP engine address, so it cannot run the optimization studio.",
      ),
    );
  }
}
