/** The HTTP configuration editor agent lends the studio's HTTP agent panel (§10, §10.1). */

import { uiTokens } from "@langwatch/module";

import type { HttpAuth, HttpHeader, HttpMethod } from "./config/http.ts";
import type { HttpTestResult } from "./http-test.ts";

/** What an HTTP agent's properties panel hands agent's configuration editor. */
export type HttpConfigEditorProps = {
  url: string;
  onUrlChange: (url: string) => void;
  method: HttpMethod;
  onMethodChange: (method: HttpMethod) => void;
  bodyTemplate: string;
  onBodyTemplateChange: (body: string) => void;
  outputPath: string;
  onOutputPathChange: (path: string) => void;
  auth: HttpAuth | undefined;
  onAuthChange: (auth: HttpAuth | undefined) => void;
  headers: HttpHeader[];
  onHeadersChange: (headers: HttpHeader[]) => void;
  onTest: (templateVariables: Record<string, unknown>) => Promise<HttpTestResult>;
  paddingX?: number | string;
  /** The saved agent's credentials are shown as "Stored on the agent" and cannot be edited. */
  credentialsReadOnly?: boolean;
};

export const HttpConfigEditorToken =
  uiTokens("agent").component<HttpConfigEditorProps>("httpConfigEditor");
