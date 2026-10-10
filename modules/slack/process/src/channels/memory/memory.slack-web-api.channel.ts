import {
  SlackWebApiChannel,
  type SlackIdentityResult,
  type SlackWorkspaceIdentity,
} from "../slack-web-api.channel.ts";

/** The memory twin: accepts the tokens it was told about, refuses the rest with `invalid_auth`. */
export class MemorySlackWebApiChannel extends SlackWebApiChannel {
  readonly #answers = new Map<string, SlackIdentityResult>();
  readonly checked: string[] = [];

  static create(): MemorySlackWebApiChannel {
    return new MemorySlackWebApiChannel();
  }

  accept({ token, identity }: { token: string; identity: SlackWorkspaceIdentity }): void {
    this.#answers.set(token, { ok: true, identity });
  }

  refuse({ token, error }: { token: string; error: string }): void {
    this.#answers.set(token, { ok: false, error });
  }

  fetchWorkspaceIdentity({ token }: { token: string }): Promise<SlackIdentityResult> {
    this.checked.push(token);
    return Promise.resolve(this.#answers.get(token) ?? { ok: false, error: "invalid_auth" });
  }
}
