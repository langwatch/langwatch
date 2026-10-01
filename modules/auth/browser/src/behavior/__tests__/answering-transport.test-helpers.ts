import type { ModuleApiMap, RouterFromMap } from "@langwatch/api/web";
import { createTRPCClient, getUntypedClient, httpLink } from "@trpc/client";

import type { UiFeatureApiTransport } from "../ui-session-queries";

export type ProcedureInput = Readonly<Record<string, unknown>>;
export type ProcedureAnswer = (path: string, input: ProcedureInput) => Promise<unknown>;

const TEST_ENDPOINT = "http://ui.test/api/trpc";

function asInput(value: unknown): ProcedureInput {
  return typeof value === "object" && value !== null
    ? Object.fromEntries(Object.entries(value))
    : {};
}

function inputOf(url: URL): ProcedureInput {
  const raw = url.searchParams.get("input");
  return asInput(raw === null ? {} : JSON.parse(raw));
}

/** The real browser client over a fetch that answers each procedure from the test. */
export function answeringTransport(answer: ProcedureAnswer): UiFeatureApiTransport {
  const fetch: typeof globalThis.fetch = async (request) => {
    const url = new URL(request instanceof Request ? request.url : String(request));
    const path = decodeURIComponent(
      url.pathname.slice(new URL(TEST_ENDPOINT).pathname.length + 1),
    );
    const data = await answer(path, inputOf(url));
    return new Response(JSON.stringify({ result: { data } }), {
      headers: { "content-type": "application/json" },
    });
  };
  return getUntypedClient(
    createTRPCClient<RouterFromMap<ModuleApiMap>>({
      links: [httpLink({ url: TEST_ENDPOINT, fetch })],
    }),
  );
}
