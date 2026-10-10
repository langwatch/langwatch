import type { SubsystemProbeChannel, SubsystemProbeRequest } from "../subsystem-probe.channel.ts";

type RecordedProbeRequest = SubsystemProbeRequest & { readonly method: "GET" | "POST" };

/** Records every canary and answers each with the configured response. */
export class MemorySubsystemProbeChannel implements SubsystemProbeChannel {
  readonly #requests: RecordedProbeRequest[] = [];
  readonly #answer: () => Response;

  private constructor(answer: () => Response) {
    this.#answer = answer;
  }

  static create({
    answer = () => new Response("{}", { status: 200 }),
  }: { answer?: () => Response } = {}): MemorySubsystemProbeChannel {
    return new MemorySubsystemProbeChannel(answer);
  }

  post(request: SubsystemProbeRequest & { body: string }): Promise<Response> {
    this.#requests.push({ ...request, method: "POST" });
    return Promise.resolve(this.#answer());
  }

  get(request: SubsystemProbeRequest): Promise<Response> {
    this.#requests.push({ ...request, method: "GET" });
    return Promise.resolve(this.#answer());
  }

  requests(): readonly RecordedProbeRequest[] {
    return this.#requests;
  }
}
