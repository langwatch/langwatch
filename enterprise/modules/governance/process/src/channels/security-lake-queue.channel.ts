// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { GovernanceObjectStorageCredentials } from "./object-store.channel.ts";

export type SecurityLakeQueueTarget = {
  queueUrl: string;
  region: string;
  endpoint?: string;
  credentials: GovernanceObjectStorageCredentials;
  signal?: AbortSignal;
};

export type SecurityLakeQueueMessage = {
  messageId: string;
  receiptHandle: string;
  body: string;
  /** How many times the queue has handed this message out, this time included. */
  receiveCount: number;
};

/** A Security Lake subscriber's SQS queue: one object-created notification per Parquet file. */
export interface SecurityLakeQueue {
  receive(
    input: SecurityLakeQueueTarget & { maxMessages: number },
  ): Promise<SecurityLakeQueueMessage[]>;
  delete(input: SecurityLakeQueueTarget & { receiptHandle: string }): Promise<void>;
  /** Hides a received message from other readers for this long from now; 0 hands it back at once. */
  changeVisibility(
    input: SecurityLakeQueueTarget & { receiptHandle: string; visibilityTimeoutSeconds: number },
  ): Promise<void>;
  /** Reads the queue's backlog without taking a message, for a connection test and the health. */
  probe(input: SecurityLakeQueueTarget): Promise<{ waiting: number; inFlight: number }>;
}
