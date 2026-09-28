import {
  Auth0PasswordChannel,
  type Auth0PasswordChangeOutcome,
  type Auth0PasswordChangeRequest,
} from "../auth0-password.channel.ts";

/** Answers every change with the outcome it was built with, and records each request. */
export class MemoryAuth0PasswordChannel extends Auth0PasswordChannel {
  static create(outcome: Auth0PasswordChangeOutcome): MemoryAuth0PasswordChannel {
    return new MemoryAuth0PasswordChannel(outcome);
  }

  readonly requests: Auth0PasswordChangeRequest[] = [];

  private constructor(private readonly outcome: Auth0PasswordChangeOutcome) {
    super();
  }

  async changePassword(input: Auth0PasswordChangeRequest): Promise<Auth0PasswordChangeOutcome> {
    this.requests.push(input);
    return this.outcome;
  }
}
