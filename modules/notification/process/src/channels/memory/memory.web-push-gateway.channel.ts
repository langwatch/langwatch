import type {
  WebPushGateway,
  WebPushRequest,
  WebPushResponse,
} from "../web-push-gateway.channel.ts";

/** Records every push and answers from a script, 201 when the script is empty. */
export class MemoryWebPushGatewayChannel implements WebPushGateway {
  readonly sent: WebPushRequest[] = [];
  #answers: (WebPushResponse | Error)[] = [];

  private constructor() {}

  static create(): MemoryWebPushGatewayChannel {
    return new MemoryWebPushGatewayChannel();
  }

  /** The next answers, in order: a response, or an error the send throws. */
  answerWith(...answers: (WebPushResponse | Error)[]): void {
    this.#answers.push(...answers);
  }

  async send(request: WebPushRequest): Promise<WebPushResponse> {
    this.sent.push(request);
    const next = this.#answers.shift();
    if (next instanceof Error) throw next;
    return next ?? { status: 201 };
  }
}
