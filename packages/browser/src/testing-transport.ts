/**
 * The real browser transport for a component test: production's links and
 * wire format, with only the network replaced by the test's answers, so a
 * feature's tRPC hooks run unmocked.
 */

import { createUiFeatureApiClient, type UiFeatureApiTransport } from "./transport.ts";

/** One procedure call as the wire carried it. */
export type UiProcedureCall = { path: string; input: unknown };

/** The test's answer to one call; reject for a path the test does not expect. */
export type UiProcedureAnswer = (call: UiProcedureCall) => Promise<unknown>;

/** Rejected with by an answer to send a tRPC error in its place, as the server would. */
export class UiProcedureRefusal extends Error {
  constructor(
    readonly code: string,
    readonly httpStatus: number,
  ) {
    super(code);
    this.name = "UiProcedureRefusal";
  }
}

async function settle(answer: UiProcedureAnswer, call: UiProcedureCall): Promise<object> {
  try {
    return { result: { data: await answer(call) } };
  } catch (error) {
    if (!(error instanceof UiProcedureRefusal)) throw error;
    return {
      error: {
        message: error.code,
        code: -32603,
        data: {
          code: error.code,
          httpStatus: error.httpStatus,
          path: call.path,
          // The handled payload production's error formatter adds, which `readHandledError` reads.
          error: { code: error.code, httpStatus: error.httpStatus, meta: {} },
        },
      },
    };
  }
}

const TEST_ENDPOINT = "http://ui.test/api/trpc";

function inputsOf({
  raw,
  count,
  batched,
}: {
  raw: unknown;
  count: number;
  batched: boolean;
}): unknown[] {
  if (!batched) return [raw];
  const batch: Record<string, unknown> =
    typeof raw === "object" && raw !== null ? Object.fromEntries(Object.entries(raw)) : {};
  return Array.from({ length: count }, (_, index) => batch[String(index)]);
}

/** A transport whose every query and mutation is answered by `answer`. */
export function answeringUiTransport(answer: UiProcedureAnswer): UiFeatureApiTransport {
  const fetch: typeof globalThis.fetch = async (request, init) => {
    const url = new URL(request instanceof Request ? request.url : String(request));
    const paths = decodeURIComponent(
      url.pathname.slice(new URL(TEST_ENDPOINT).pathname.length + 1),
    ).split(",");
    const batched = url.searchParams.get("batch") === "1";
    const encoded = init?.method === "POST" ? init.body : url.searchParams.get("input");
    const raw: unknown =
      typeof encoded === "string" && encoded !== "" ? JSON.parse(encoded) : void 0;
    const inputs = inputsOf({ raw, count: paths.length, batched });
    const results = await Promise.all(
      paths.map((path, index) => settle(answer, { path, input: inputs[index] })),
    );
    return new Response(JSON.stringify(batched ? results : results[0]), {
      headers: { "content-type": "application/json" },
    });
  };
  return createUiFeatureApiClient({ url: TEST_ENDPOINT, fetch });
}
