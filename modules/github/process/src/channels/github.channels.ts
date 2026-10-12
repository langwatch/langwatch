import type { GithubAppClient } from "../app/github.app.ts";

/** Every channel github holds, as the container hands them to the module class. */
export interface GithubChannels {
  readonly api: GithubAppClient;
}
