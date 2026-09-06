export interface TokenizerClient {
  countTokens(
    model: string,
    text: string | undefined,
  ): Promise<number | undefined>;
}

export class NullTokenizerClient implements TokenizerClient {
  async countTokens(
    _model: string,
    _text: string | undefined,
  ): Promise<undefined> {
    return undefined;
  }
}
