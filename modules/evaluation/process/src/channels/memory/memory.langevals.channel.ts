import type { LangevalsChannel, LangevalsPost } from "../langevals.channel.ts";

/** Records every post and answers from a scripted queue; an empty queue refuses by name. */
export class MemoryLangevalsChannel implements LangevalsChannel {
  static create(): MemoryLangevalsChannel {
    return new MemoryLangevalsChannel();
  }

  readonly posts: LangevalsPost[] = [];
  readonly #answers: Response[] = [];

  private constructor() {}

  answerWith(response: Response): void {
    this.#answers.push(response);
  }

  async post(input: LangevalsPost): Promise<Response> {
    input.signal?.throwIfAborted();
    this.posts.push(input);
    const answer = this.#answers.shift();
    if (!answer) throw new Error(`no scripted langevals answer for ${input.kind}`);
    return answer;
  }
}
