/**
 * Test double for the staff access procedures: an in-memory backend whose reads re-render on
 * `setData`, whose writes record their input and answer from a replaceable handler.
 */

import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import type {
  StaffAccessApprovalView,
  StaffAccessOverview,
  StaffAccessRequesterView,
  StaffAccessSessionView,
} from "@langwatch/staff-access-contract";
import { nowInstant } from "@langwatch/time";
import type { ReactElement } from "react";
import { useState, useSyncExternalStore } from "react";

type Mutation =
  | "enrolOptions"
  | "enrol"
  | "revokeRequester"
  | "approvalOptions"
  | "approve"
  | "deny"
  | "revokeSession"
  | "revokeAll";

type Handler = (input: unknown) => unknown;

export const PASSKEY_OPTIONS = {
  challenge: "c2lnbi10aGlzLWV4YWN0LWhhc2gtcGxlYXNl",
  rpId: "localhost",
  timeout: 60_000,
  userVerification: "required" as const,
  allowCredentials: [{ id: "Y3JlZC0x", type: "public-key" as const, transports: ["internal"] }],
};

/** A refusal as the tRPC transport carries it. */
export function handledError(code: string, httpStatus: number, meta: object = {}) {
  return Object.assign(new Error(code), {
    data: { error: { code, httpStatus, fault: "customer", meta } },
  });
}

function minutesFromNow(minutes: number): string {
  return nowInstant().add({ minutes }).toString();
}

export function requester(overrides: Partial<StaffAccessRequesterView> = {}) {
  return {
    id: "req_1",
    name: "laptop agent",
    createdAt: "2026-10-01T10:00:00.000Z",
    expiresAt: "2026-12-30T10:00:00.000Z",
    lastUsedAt: null,
    revokedAt: null,
    ...overrides,
  } satisfies StaffAccessRequesterView;
}

export function session(overrides: Partial<StaffAccessSessionView> = {}) {
  return {
    requestId: "sar_1",
    status: "redeemed",
    scopes: ["org:metadata"],
    organizationId: "org_acme",
    organizationName: "ACME",
    counterpartOrganizationId: null,
    counterpartOrganizationName: null,
    reason: "check why the ACME evaluator fails",
    machine: "olivia-mbp",
    requestIp: "203.0.113.7",
    requesterName: "laptop agent",
    ownerUserId: "user_olivia",
    ownerEmail: "olivia@langwatch.ai",
    spendApproved: false,
    createdAt: "2026-11-02T09:00:00.000Z",
    expiresAt: "2026-11-02T09:10:00.000Z",
    approvedAt: "2026-11-02T09:01:00.000Z",
    redeemedAt: "2026-11-02T09:02:00.000Z",
    accessExpiresAt: minutesFromNow(30),
    revokedAt: null,
    ...overrides,
  } satisfies StaffAccessSessionView;
}

export function approvalView(overrides: Partial<StaffAccessApprovalView> = {}) {
  return {
    ...session({
      status: "pending",
      approvedAt: null,
      redeemedAt: null,
      accessExpiresAt: null,
      expiresAt: minutesFromNow(10),
    }),
    typedNameRequired: { withSpend: false, withoutSpend: false },
    spendOffered: false,
    copyGrant: [],
    ...overrides,
  } satisfies StaffAccessApprovalView;
}

class FakeStaffAccessBackend {
  overview: StaffAccessOverview | undefined;
  overviewError: unknown = null;
  approval: StaffAccessApprovalView | undefined;
  approvalError: unknown = null;
  /** How many times a screen asked to read the overview again. */
  refetches = 0;
  readonly calls: { procedure: Mutation; input: unknown }[] = [];
  handlers: Partial<Record<Mutation, Handler>> = {};
  private version = 0;
  private readonly listeners = new Set<() => void>();

  reset() {
    this.overview = { hasPasskey: true, requesters: [requester()], sessions: [session()] };
    this.overviewError = null;
    this.approval = approvalView();
    this.approvalError = null;
    this.calls.length = 0;
    this.refetches = 0;
    this.handlers = {};
    this.changed();
  }

  changed() {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  snapshot = () => this.version;

  callsTo(procedure: Mutation): unknown[] {
    return this.calls.filter((call) => call.procedure === procedure).map((call) => call.input);
  }

  answer(procedure: Mutation, input: unknown): unknown {
    this.calls.push({ procedure, input });
    const handler = this.handlers[procedure];
    if (handler) return handler(input);
    return this.defaultAnswer(procedure);
  }

  private defaultAnswer(procedure: Mutation): unknown {
    switch (procedure) {
      case "enrolOptions":
      case "approvalOptions":
        return PASSKEY_OPTIONS;
      case "enrol":
        return {
          requesterKey: "lwsr_lookup123_s3cr3t",
          requester: requester({ id: "req_new", name: "desk agent" }),
        };
      case "approve":
        return { ...this.approval, status: "approved", approvedAt: nowInstant().toString() };
      case "deny":
        return { ...this.approval, status: "denied" };
      case "revokeRequester":
      case "revokeSession":
        return { ok: true };
      case "revokeAll":
        return { revoked: 2, failed: 0 };
    }
  }
}

export const backend = new FakeStaffAccessBackend();

function useQuery<T>(read: () => { data: T | undefined; error: unknown }) {
  useSyncExternalStore(backend.subscribe, backend.snapshot);
  const { data, error } = read();
  return {
    data: error ? undefined : data,
    error: error ?? null,
    isLoading: false,
    refetch: async () => {
      backend.refetches += 1;
      backend.changed();
      return { data };
    },
  };
}

function mutation(procedure: Mutation) {
  return {
    useMutation: () => {
      const [isPending, setPending] = useState(false);
      return {
        isPending,
        mutateAsync: async (input?: unknown) => {
          setPending(true);
          try {
            return await backend.answer(procedure, input);
          } finally {
            setPending(false);
          }
        },
      };
    },
  };
}

/** Stands in for `staffAccessApi`: `vi.mock` the binding module to answer with it. */
export const fakeStaffAccessApi = {
  useUtils: () => ({
    staffAccess: {
      overview: {
        setData: (
          _input: unknown,
          update: (current: StaffAccessOverview | undefined) => StaffAccessOverview | undefined,
        ) => {
          backend.overview = update(backend.overview);
          backend.changed();
        },
      },
      getApprovalRequest: {
        setData: (_input: unknown, view: StaffAccessApprovalView) => {
          backend.approval = view;
          backend.changed();
        },
      },
    },
  }),
  staffAccess: {
    overview: {
      useQuery: () => useQuery(() => ({ data: backend.overview, error: backend.overviewError })),
    },
    getApprovalRequest: {
      useQuery: () => useQuery(() => ({ data: backend.approval, error: backend.approvalError })),
    },
    enrolOptions: mutation("enrolOptions"),
    enrol: mutation("enrol"),
    revokeRequester: mutation("revokeRequester"),
    approvalOptions: mutation("approvalOptions"),
    approve: mutation("approve"),
    deny: mutation("deny"),
    revokeSession: mutation("revokeSession"),
    revokeAll: mutation("revokeAll"),
  },
};

/** What `startAuthentication` resolves with when the operator touches their passkey. */
export const PASSKEY_ASSERTION = {
  id: "Y3JlZC0x",
  rawId: "Y3JlZC0x",
  type: "public-key" as const,
  response: {
    clientDataJSON: "Y2xpZW50",
    authenticatorData: "YXV0aA",
    signature: "c2ln",
  },
  clientExtensionResults: {},
};

export function renderStaffAccess(element: ReactElement) {
  return renderWithDesignSystem(element);
}
