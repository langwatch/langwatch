/**
 * One Customer.io sink for every lifecycle-signal suite in this package.
 */
import { vi } from "vitest";

import type {
  NurturingProfile,
  NurturingProfileRepository,
} from "../../../repositories/nurturing-profile.repository.ts";
import type { OrganizationAdminResolver } from "../../../rules/nurturing-sink-registry-service.rules.ts";
import { BillingErrorReporter } from "../../billing-error-reporter.service.ts";
import { NurturingService } from "../../nurturing.service.ts";

/** What the suite composed, as `BillingApp` composes it: each signal is handed these. */
export type NurturingWiring = {
  nurturing: NurturingService | undefined;
  profiles: NurturingProfileRepository | undefined;
  resolveOrgAdmin: OrganizationAdminResolver | undefined;
};

let current: NurturingWiring = { nurturing: void 0, profiles: void 0, resolveOrgAdmin: void 0 };

/** The sink, reader and resolver the suite registered last, to hand to a signal. */
export function wiring(): NurturingWiring {
  return current;
}

/** Registers how an organization admin is resolved, or none. */
export function registerOrganizationAdminResolver(resolve: OrganizationAdminResolver | null): void {
  current = { ...current, resolveOrgAdmin: resolve ?? void 0 };
}

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
  const fetchFn = vi.fn<typeof fetch>(async () => {
    if (hanging) return new Promise<Response>(() => undefined);
    if (failing) throw new Error("customer.io unreachable");
    return new Response(null, { status: 200 });
  });
  const errorReporter = new RecordingErrorReporter();

  current = {
    ...current,
    nurturing: NurturingService.create({
      config: { customerIoApiKey: "test-key", customerIoRegion: "us" },
      fetchFn,
      errorReporter,
    }),
  };

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
  current = { ...current, nurturing: void 0 };
}

/** Registers a profile reader that answers one fixed profile, or none, for every lookup. */
export function registerProfileReader(
  profile: NurturingProfile | null,
  memberUserIds: string[] = [],
): void {
  current = {
    ...current,
    profiles: {
      findProfile: async () => profile,
      memberUserIds: async () => memberUserIds,
    },
  };
}

/** Registers a profile reader whose lookup rejects, for failure-path tests. */
export function registerFailingProfileReader(error: unknown): void {
  current = {
    ...current,
    profiles: {
      findProfile: async () => {
        throw error;
      },
      memberUserIds: async () => [],
    },
  };
}

/** Registers no profile reader at all. */
export function registerNoProfileReader(): void {
  current = { ...current, profiles: void 0 };
}

/** Lets the fire-and-forget calls settle before the assertions read them. */
export async function settle(): Promise<void> {
  for (let tick = 0; tick < 3; tick++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
