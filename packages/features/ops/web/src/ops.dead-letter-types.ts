import type { ReactNode } from "react";

/** Exactly what this surface renders; a structural subset of the server view. */
export interface DeadLetterMessage {
  id: string;
  processName: string;
  projectId: string;
  processKey: string;
  messageKey: string;
  intentType: string;
  attempts: number;
  updatedAt: number;
  traceId: string | null;
  payload: unknown;
}

export interface DeadLetterProcessCount {
  processName: string;
  count: number;
  oldestUpdatedAt: number;
}

export interface DeadLetterAttempt {
  id: string;
  attempt: number;
  outcome: string;
  errorType: string;
  errorMessage: string;
}

export type DeadLetterAttemptHistoryRenderer = (
  message: Pick<DeadLetterMessage, "id" | "projectId">,
) => ReactNode;
