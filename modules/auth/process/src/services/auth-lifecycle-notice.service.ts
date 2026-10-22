import type { AppPage } from "@langwatch/auth-contract";
import type { EventingCommandSender } from "@langwatch/eventing";
import { nowInstant } from "@langwatch/time";

import type {
  RecordAppPageOpenedCommandData,
  RecordSessionStartedCommandData,
  RecordSignedUpCommandData,
  RecordSsoAutoAddedCommandData,
} from "../eventing/auth-lifecycle.events.ts";

type Sender<Data> = Pick<EventingCommandSender<Data>, "send">;

export type AuthLifecycleSenders = Readonly<{
  recordSessionStarted: Sender<RecordSessionStartedCommandData>;
  recordSsoAutoAdded: Sender<RecordSsoAutoAddedCommandData>;
  recordSignedUp: Sender<RecordSignedUpCommandData>;
  recordAppPageOpened: Sender<RecordAppPageOpenedCommandData>;
}>;

/**
 * Where a sign-up, a session and a domain auto-join are recorded as auth's events, which the
 * worker hands to nurturing (§9). The senders arrive once the pipeline registers, and a record
 * that fails is reported, never thrown: a sign-in never fails because it was not announced.
 */
export class AuthLifecycleNoticeService {
  static create(dependencies: {
    reportError: (error: unknown) => void;
  }): AuthLifecycleNoticeService {
    return new AuthLifecycleNoticeService(dependencies);
  }

  #senders: AuthLifecycleSenders | undefined;

  private constructor(private readonly dependencies: { reportError: (error: unknown) => void }) {}

  connect(senders: AuthLifecycleSenders): void {
    this.#senders = senders;
  }

  /** A new person, for nurturing's PostHog signed_up; auth never holds an analytics client. */
  signedUp(input: Readonly<{ userId: string }>): void {
    this.#send(this.#senders?.recordSignedUp, {
      tenantId: input.userId,
      occurredAt: this.#now(),
      userId: input.userId,
    });
  }

  sessionStarted(input: Readonly<{ userId: string }>): void {
    this.#send(this.#senders?.recordSessionStarted, {
      tenantId: input.userId,
      occurredAt: this.#now(),
      userId: input.userId,
    });
  }

  /** A person opened an app page in the browser; ids and the page only. */
  appPageOpened(input: Readonly<{ userId: string; page: AppPage }>): void {
    this.#send(this.#senders?.recordAppPageOpened, {
      tenantId: input.userId,
      occurredAt: this.#now(),
      userId: input.userId,
      page: input.page,
    });
  }

  ssoAutoAdded(
    input: Readonly<{ userId: string; organizationId: string; organizationName: string }>,
  ): void {
    this.#send(this.#senders?.recordSsoAutoAdded, {
      tenantId: input.organizationId,
      occurredAt: this.#now(),
      userId: input.userId,
      organizationId: input.organizationId,
      organizationName: input.organizationName,
    });
  }

  #now(): number {
    return nowInstant().epochMilliseconds;
  }

  #send<Data extends Record<string, unknown>>(sender: Sender<Data> | undefined, data: Data): void {
    if (!sender) {
      this.dependencies.reportError(new Error("auth_lifecycle is not registered in this process"));
      return;
    }
    void Promise.resolve()
      .then(() => sender.send(data))
      .catch((failure: unknown) => this.dependencies.reportError(failure));
  }
}
