/**
 * What a browser installs when it installs github: the connect popup it lends
 * langy by token. The Integrations screen is integration's.
 */

import { defineBrowserModule } from "@langwatch/browser";
import { GithubConnectPopupToken } from "@langwatch/github-client";

import { githubConnectPopup } from "./behavior/github-connect-popup.ts";

export const githubWeb = defineBrowserModule("github").lends(GithubConnectPopupToken, {
  value: githubConnectPopup,
});
