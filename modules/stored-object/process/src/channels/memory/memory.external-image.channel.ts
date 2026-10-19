import type { ExternalImageChannel, ExternalImageResponse } from "../external-image.channel.ts";

/** Answers each address from a table; an address it does not hold fails as a refused fetch. */
export class MemoryExternalImageChannel implements ExternalImageChannel {
  readonly requested: string[] = [];
  readonly #answers: ReadonlyMap<string, ExternalImageResponse>;

  private constructor(answers: ReadonlyMap<string, ExternalImageResponse>) {
    this.#answers = answers;
  }

  static create(
    answers: Readonly<Record<string, ExternalImageResponse>> = {},
  ): MemoryExternalImageChannel {
    return new MemoryExternalImageChannel(new Map(Object.entries(answers)));
  }

  async fetch(url: string): Promise<ExternalImageResponse> {
    this.requested.push(url);
    const answer = this.#answers.get(url);
    if (!answer) throw new Error("address refused");

    return answer;
  }
}
