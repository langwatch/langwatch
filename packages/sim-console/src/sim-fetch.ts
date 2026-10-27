import { z } from "zod";

// A simulator's CSP refuses eval. Set before any schema is built: Zod probes for
// eval as it constructs an object schema, and the probe logs a CSP violation.
z.config({ jitless: true });

const REQUEST_TIMEOUT_MS = 5_000;

/** Simulators answer `{"error": "..."}`; an OpenAI-shaped `{"error": {"message"}}` reads too. */
const refusalSchema = z.object({
  error: z.union([z.string(), z.object({ message: z.string() })]),
});

/** A simulator answered outside 2xx: `message` is its own words when it gave any. */
export class SimFetchError extends Error {
  readonly status: number;

  constructor({ status, message }: { status: number; message: string }) {
    super(message);
    this.name = "SimFetchError";
    this.status = status;
  }
}

const refusalOf = async ({ response }: { response: Response }) => {
  const body = await response.json().catch(() => undefined);
  const parsed = refusalSchema.safeParse(body);
  if (!parsed.success) return `Request failed (${response.status}). Please retry.`;
  const { error } = parsed.data;
  return typeof error === "string" ? error : error.message;
};

/** GETs `path` from the console's own origin and parses the answer with `schema`. */
export const simFetch = async <T>({ path, schema }: { path: string; schema: z.ZodType<T> }) => {
  const response = await fetch(path, {
    cache: "no-store",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new SimFetchError({
      status: response.status,
      message: await refusalOf({ response }),
    });
  }
  return schema.parse(await response.json());
};
