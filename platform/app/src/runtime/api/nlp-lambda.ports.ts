export type NlpLambdaPayloadStageRequest = {
  projectId: string;
  keyPrefix: string;
  serialized: Buffer;
  ttlSeconds: number;
};

export abstract class NlpLambdaStagedPayload {
  declare protected readonly nlpLambdaStagedPayloadBrand: "NlpLambdaStagedPayload";

  abstract readonly url: string;

  abstract delete(): Promise<void>;
}

export abstract class NlpLambdaPayloadStagingPort {
  declare protected readonly nlpLambdaPayloadStagingPortBrand: "NlpLambdaPayloadStagingPort";

  abstract stage(input: NlpLambdaPayloadStageRequest): Promise<NlpLambdaStagedPayload>;
}

export type NlpLambdaExceptionReport = {
  error: Error;
  extra: Record<string, unknown>;
};

export abstract class NlpLambdaErrorReportingPort {
  declare protected readonly nlpLambdaErrorReportingPortBrand: "NlpLambdaErrorReportingPort";

  abstract capture(input: NlpLambdaExceptionReport): void;
}

export class NoopNlpLambdaPayloadStagingPort extends NlpLambdaPayloadStagingPort {
  async stage(): Promise<NlpLambdaStagedPayload> {
    throw new Error("NLP Lambda payload staging is not configured.");
  }
}

export class NoopNlpLambdaErrorReportingPort extends NlpLambdaErrorReportingPort {
  capture(): void {}
}
