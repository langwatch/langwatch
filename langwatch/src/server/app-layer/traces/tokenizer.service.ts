import { TiktokenClient } from "../clients/tokenizer/tiktoken.client";
import {
  NullTokenizerClient,
  type TokenizerClient,
} from "../clients/tokenizer/tokenizer.client";

export class TokenizerService {
  constructor(readonly client: TokenizerClient) {}

  static create(config: { disableTokenization?: boolean }): TokenizerService {
    const client = config.disableTokenization
      ? new NullTokenizerClient()
      : new TiktokenClient();
    return new TokenizerService(client);
  }

  countTokens(
    model: string,
    text: string | undefined,
  ): Promise<number | undefined> {
    return this.client.countTokens(model, text);
  }
}
