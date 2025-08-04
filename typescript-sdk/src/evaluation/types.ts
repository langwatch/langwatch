export class EvaluationError extends Error {
  readonly httpStatus: number;
  readonly body: unknown;

  constructor(message: string, httpStatus: number, body: unknown) {
    super(message);
    this.name = "EvaluationError";
    this.httpStatus = httpStatus;
    this.body = body;
  }
}

export interface EvaluationResultModel {
  status: "processed" | "skipped" | "error";
  passed?: boolean;
  score?: number;
  details?: string;
  label?: string;
  cost?: {
    currency: string;
    amount: number;
  };
}
