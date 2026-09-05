/**
 * One Customer.io sink for every lifecycle-signal suite in this package.
 */
import { vi } from "vitest";
import { BillingErrorReporter } from "../../../ports/error-reporter.port";
import { NurturingService } from "../../nurturing.service";
import { setNurturingSink } from "../../nurturing-sink";

export class RecordingErrorReporter extends BillingErrorReporter {
  readonly capture = vi.fn();
}

export type SentCall = {
  path: string;
  body: Record<string, unknown>;
};

export type NurturingHarness = {
  fetchFn: ReturnType<typeof vi.fn>;
  errorReporter: RecordingErrorReporter;
  /** Every request the sink put on the wire, in order. */
  sent: () => SentCall[];
  /** The requests to one endpoint, e.g. "/identify". */
  sentTo: (path: string) => Record<string, unknown>[];
};

/** Registers a working sink and answers what it sent. */
export function registerNurturingSink({ failing = false, hanging = false } = {}): NurturingHarness {
  const fetchFn = vi.fn(async () => {
    if (hanging) return new Promise<Response>(() => undefined);
    if (failing) throw new Error("customer.io unreachable");
    return new Response(null, { status: 200 });
  });
  const errorReporter = new RecordingErrorReporter();

  setNurturingSink(
    NurturingService.create({
      config: { customerIoApiKey: "test-key", customerIoRegion: "us" },
      fetchFn: fetchFn as unknown as typeof fetch,
      errorReporter,
    }),
  );

  const sent = (): SentCall[] =>
    fetchFn.mock.calls.map(([url, options]) => ({
      path: new URL(url as string).pathname.replace("/v1", ""),
      body: JSON.parse((options as { body: string }).body) as Record<string, unknown>,
    }));

  return {
    fetchFn,
    errorReporter,
    sent,
    sentTo: (path: string) =>
      sent()
        .filter((call) => call.path === path)
        .map((call) => call.body),
  };
}

/** Registers no sink at all, as a deployment with no Customer.io key composes. */
export function registerNoNurturingSink(): void {
  setNurturingSink(null);
}

/** Lets the fire-and-forget calls settle before the assertions read them. */
export async function settle(): Promise<void> {
  for (let tick = 0; tick < 3; tick++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
