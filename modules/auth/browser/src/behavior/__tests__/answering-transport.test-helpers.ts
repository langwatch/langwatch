import { createUiFeatureApiClient } from "@langwatch/browser-host/transport";

import type { UiFeatureApiTransport } from "../ui-session-queries";

export type ProcedureInput = Readonly<Record<string, unknown>>;
export type ProcedureAnswer = (path: string, input: ProcedureInput) => Promise<unknown>;

const TEST_ENDPOINT = "http://ui.test/api/trpc";

function asInput(value: unknown): ProcedureInput {
  return typeof value === "object" && value !== null
    ? Object.fromEntries(Object.entries(value))
    : {};
}

function inputsOf({ url, count }: { url: URL; count: number }): ProcedureInput[] {
  const raw = url.searchParams.get("input");
  const parsed: unknown = raw === null ? {} : JSON.parse(raw);
  if (url.searchParams.get("batch") !== "1") return [asInput(parsed)];
  const batch = asInput(parsed);
  return Array.from({ length: count }, (_, index) => asInput(batch[String(index)]));
}

/** The real browser client over a fetch that answers each procedure from the test. */
export function answeringTransport(answer: ProcedureAnswer): UiFeatureApiTransport {
  const fetch: typeof globalThis.fetch = async (request) => {
    const url = new URL(request instanceof Request ? request.url : String(request));
    const paths = decodeURIComponent(
      url.pathname.slice(new URL(TEST_ENDPOINT).pathname.length + 1),
    ).split(",");
    const inputs = inputsOf({ url, count: paths.length });
    const results = await Promise.all(
      paths.map(async (path, index) => ({
        result: { data: await answer(path, inputs[index] ?? {}) },
      })),
    );
    const body = url.searchParams.get("batch") === "1" ? results : results[0];
    return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
  };
  return createUiFeatureApiClient({ url: TEST_ENDPOINT, fetch });
}
