/**
 * One message for Customer.io's transactional API: already rendered here, so Customer.io only
 * delivers it. One recipient per request, which is what lets a failure fall back for that
 * recipient alone.
 */
export type CustomerIoTransactionalRequest = Readonly<{
  /** Our template id: the trigger name of the transactional message in Customer.io. */
  transactionalMessageId: string;
  /** The person Customer.io files the delivery under. */
  identifiers: Readonly<{ email: string }>;
  to: string;
  from: string;
  subject: string;
  /** Our rendered HTML; it replaces whatever body the message holds in Customer.io. */
  body: string;
  replyTo?: string;
  headers?: Readonly<Record<string, string>>;
}>;

/** Why a send did not reach Customer.io's queue: what a warning names instead of the request. */
export type CustomerIoTransactionalFailureReason =
  | "status"
  | "timeout"
  | "network"
  | "unreadable-reply";

/**
 * A send Customer.io did not accept. Carries the reply status and a reason class only: the
 * request holds a recipient address and the client holds the key, and this is logged.
 */
export class CustomerIoTransactionalError extends Error {
  constructor(
    readonly reason: CustomerIoTransactionalFailureReason,
    readonly status?: number,
  ) {
    super(
      status === undefined
        ? `Customer.io transactional send failed (${reason})`
        : `Customer.io transactional send failed (${reason} ${status})`,
    );
    this.name = "CustomerIoTransactionalError";
  }
}

/** Customer.io's transactional email API: hands one rendered message over, or throws. */
export abstract class CustomerIoTransactionalChannel {
  abstract send(request: CustomerIoTransactionalRequest): Promise<{ deliveryId: string }>;

  abstract close(): Promise<void>;
}
