// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { PeopleListing } from "../features/identity/rules/people-listing.rules.ts";

/** Asking the Anthropic and OpenAI admin APIs who is on the organization's staff. */
export interface AdminApiUsersChannel {
  listAnthropicPeople(args: { apiKey: string; signal?: AbortSignal }): Promise<PeopleListing>;
  listOpenAiPeople(args: { apiKey: string; signal?: AbortSignal }): Promise<PeopleListing>;
}
