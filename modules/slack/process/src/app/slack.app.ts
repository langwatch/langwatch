import { SlackApi, type SlackApi as SlackApiContract } from "@langwatch/slack-contract";

/** A project's Slack connections; packet 07 composes the repositories and services. */
export class SlackApp implements SlackApiContract {
  static readonly contract = SlackApi;
  static readonly dependencies = {};

  static create(): SlackApp {
    return new SlackApp();
  }
}
