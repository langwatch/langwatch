import { request } from "node:https";

import {
  PUBLIC_APP_CONFIG_META_NAME,
  parsePublicAppConfigMetaContent,
  type PublicAppConfig,
} from "@langwatch/config/public-app-config";

const META_CONTENT = new RegExp(`<meta name="${PUBLIC_APP_CONFIG_META_NAME}" content="([^"]+)"`);
const RETRY_EVERY_MS = 500;

/**
 * The meta tag the api renders into its own shell, lifted unchanged. The api may still be
 * booting, so an unanswered address is retried until `waitMs` lapses, then named in the refusal.
 * Scenarios: specs/ui/dev-public-config.feature
 */
export async function fetchPublicConfigFromApi({
  apiUrl,
  waitMs = 30_000,
  fetchShell = fetchShellOf,
}: {
  apiUrl: string;
  waitMs?: number;
  fetchShell?: (url: string) => Promise<Response>;
}): Promise<PublicAppConfig> {
  const shellUrl = `${apiUrl}/index.html`;
  const deadline = Date.now() + waitMs;
  let lastFailure: unknown;

  for (;;) {
    try {
      const response = await fetchShell(shellUrl);
      if (!response.ok) throw new Error(`answered ${response.status}`);
      return liftMeta({ html: await response.text(), apiUrl });
    } catch (failure) {
      if (failure instanceof MissingMetaError) throw failure;
      lastFailure = failure;
    }
    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, RETRY_EVERY_MS));
  }

  throw new Error(
    `The dev server needs the api for the page's public config, but ${shellUrl} did not answer ` +
      `(${lastFailure instanceof Error ? lastFailure.message : String(lastFailure)}). ` +
      `Start the api (haven up, or pnpm dev) or point LANGWATCH_API_URL at it.`,
    { cause: lastFailure },
  );
}

/** The hosts whose self-signed certificate the dev proxy (`secure: false`) already trusts. */
export function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname.endsWith(".localhost");
}

/** Plain fetch, except a local https api with a self-signed cert (LANGWATCH_DEV_HTTP2=1). */
export function fetchShellOf(url: string): Promise<Response> {
  const target = new URL(url);
  if (target.protocol !== "https:" || !isLocalHost(target.hostname)) return fetch(url);

  return new Promise((resolve, reject) => {
    const outgoing = request(target, { rejectUnauthorized: false }, (incoming) => {
      const chunks: Buffer[] = [];
      incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
      incoming.on("end", () =>
        resolve(new Response(Buffer.concat(chunks), { status: incoming.statusCode ?? 502 })),
      );
      incoming.on("error", reject);
    });
    outgoing.on("error", reject);
    outgoing.end();
  });
}

class MissingMetaError extends Error {}

function liftMeta({ html, apiUrl }: { html: string; apiUrl: string }): PublicAppConfig {
  const content = META_CONTENT.exec(html)?.[1];
  if (content === undefined) {
    throw new MissingMetaError(
      `The api at ${apiUrl} rendered a shell with no "${PUBLIC_APP_CONFIG_META_NAME}" meta tag.`,
    );
  }
  return parsePublicAppConfigMetaContent(content);
}
