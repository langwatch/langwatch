/**
 * Maps a User-Agent header to a coarse client-source label used by the
 * `api_active_user` heartbeat. Recognized clients send a User-Agent of the
 * form `langwatch-<product>/<version>`. Anything else collapses to `"unknown"`
 * so legacy callers without the header don't break.
 */

const SOURCE_PATTERN = /^langwatch-(mcp|cli|skill|sdk-py|sdk-ts)\/(.+)$/i;

export type ClientSource =
  | "mcp"
  | "cli"
  | "skill"
  | "sdk-py"
  | "sdk-ts"
  | "unknown";

export interface ParsedClientSource {
  source: ClientSource;
  version?: string;
}

export function parseClientSource(
  userAgent: string | undefined | null,
): ParsedClientSource {
  if (!userAgent) return { source: "unknown" };
  const match = userAgent.match(SOURCE_PATTERN);
  if (!match) return { source: "unknown" };
  const [, sourceCapture, versionCapture] = match;
  if (!sourceCapture || !versionCapture) return { source: "unknown" };
  return {
    source: sourceCapture.toLowerCase() as ClientSource,
    version: versionCapture,
  };
}
