import type {
  HttpDestinationRequest,
  HttpDestinationResponse,
} from "../http/http.destination.channel.ts";
import type { HttpWebhookSender } from "../webhook-destination.channel.ts";

type RecordedHttpRequest = Omit<HttpDestinationRequest, "tls">;

/** The HTTP channel's memory twin: keeps each request, opens no connection, answers 200. */
export class MemoryHttpDestinationChannel implements HttpWebhookSender {
  readonly #requests: RecordedHttpRequest[] = [];

  static create(): MemoryHttpDestinationChannel {
    return new MemoryHttpDestinationChannel();
  }

  private constructor() {}

  get requests(): readonly RecordedHttpRequest[] {
    return this.#requests.map((request) => ({
      ...request,
      headers: request.headers ? { ...request.headers } : undefined,
    }));
  }

  send(request: RecordedHttpRequest): Promise<HttpDestinationResponse> {
    this.#requests.push(request);
    return Promise.resolve({ status: 200, body: "", responseHeaders: {} });
  }
}
