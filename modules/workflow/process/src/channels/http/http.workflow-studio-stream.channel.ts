/**
 * Engine's streaming studio route; HTTP POST with SSE stream, no per-project Lambda routing.
 */
import {
  type WorkflowStudioStream,
  type WorkflowStudioStreamInput,
} from "../nlp-lambda.channel.ts";

/** The engine's streaming studio route at a single configured address. */
export class HttpWorkflowStudioStreamAdapter implements WorkflowStudioStream {
  static create(options: {
    /** Where the engine answers, for example `http://127.0.0.1:5561`. */
    serviceUrl: string;
    /** Injected so a test drives the wire without a listener. */
    fetch?: typeof fetch;
  }): HttpWorkflowStudioStreamAdapter {
    return new HttpWorkflowStudioStreamAdapter(options);
  }

  private constructor(private readonly options: { serviceUrl: string; fetch?: typeof fetch }) {}

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
 * The engine this deployment did not configure. Refuses by name: a run
 * dispatched at no address is one whose result nobody will ever see, not a
 * `fetch` at `undefined/go/...` reporting an opaque URL parse failure.
 */
export class UnconfiguredWorkflowStudioStreamAdapter implements WorkflowStudioStream {
  static create(): UnconfiguredWorkflowStudioStreamAdapter {
    return new UnconfiguredWorkflowStudioStreamAdapter();
  }

  private constructor() {}

  open(): Promise<ReadableStreamDefaultReader<Uint8Array>> {
    return Promise.reject(
      new Error(
        "This process was composed without an NLP engine address, so it cannot run the optimization studio.",
      ),
    );
  }
}
