export interface TokenizerClient {
  countTokens(model: string, text: string | undefined): Promise<number | undefined>;
}

export interface ProcessTokenizerClient extends TokenizerClient {
  close(): Promise<void>;
}

export class NullTokenizerClient implements ProcessTokenizerClient {
  async countTokens(_model: string, _text: string | undefined): Promise<undefined> {
    return undefined;
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}
