import type { TokenizerClient } from "../clients/tokenizer/tokenizer.client";

export class TokenizerService {
  constructor(readonly client: TokenizerClient) {}

  countTokens(
    model: string,
    text: string | undefined,
  ): Promise<number | undefined> {
    return this.client.countTokens(model, text);
  }
}
