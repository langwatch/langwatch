// The authz api as the Braids screens use it, answering from a test's state and recording writes.

import type { AuthzBraid as Braid } from "@langwatch/authz-contract";
import { expect, type Mock, vi } from "vitest";

type MutationOptions = {
  onSuccess?: (data: unknown) => void;
  onError?: (error: unknown) => void;
};

export type BraidsApiState = {
  project: { intoOtherProjects: Braid[]; fromOtherProjects: Braid[] } | undefined;
  organization: Braid[] | undefined;
  keptToAdmins: boolean;
  /** The organisation's "Braids enabled" setting; a fixture organisation has it on. */
  braidsEnabled: boolean;
  /** When set, reading the organisation's settings fails. */
  policyFails: boolean;
  /** When set, reading the organisation's settings has not answered yet. */
  policyLoading: boolean;
  /** When set, a refresh of the settings failed over the value read before it. */
  policyRefreshFails: boolean;
  /** The organisation setting whose save has not answered yet. */
  pendingSave: "policy" | "enabled" | undefined;
  policyRefetch: Mock<() => void>;
  remove: Mock<(input: unknown) => void>;
  setPolicy: Mock<(input: unknown) => void>;
  setEnabled: Mock<(input: unknown) => void>;
  targets: { projectId: string; selectable: boolean; reason?: "this_project" | "aggregate" }[];
  /** When set, the target list query fails. */
  targetsFail: boolean;
  targetsRefetch: Mock<() => void>;
  targetsAsked: Mock<(input: unknown) => void>;
  viewers: { count: number; exact: boolean };
  /** Whether the reader signs its calls: its key in use, or null. */
  readerSigning: { keyName: string; lastUsedAt: string | null } | null;
  create: Mock<(input: unknown) => void>;
  change: Mock<(input: unknown) => void>;
  /** When set, the next save fails with it instead of answering. */
  saveError: unknown;
};

type PreviewTraces = { every: number; some: number; none: number; total: number; capped: boolean };

/** The trace module's braid reads, as the Braids screens use them. */
export type BraidTraceState = {
  preview: {
    refusal: null;
    traces: PreviewTraces;
    spans: number;
    live: { braids: number; traces: PreviewTraces; spans: number };
    unsignedHidden: number | null;
    example: { traceId: string; nodes: unknown[] } | null;
  };
  previewAsked: Mock<(input: unknown) => void>;
  attributeKeys: { key: string; spanCount: number }[];
  activity: { braidId: string; spanCount: number }[] | undefined | "failed";
  testTrace: { found: boolean; nodes: unknown[] };
  testTraceAsked: Mock<(input: unknown) => void>;
};

/** The one organisation whose policy the fake holds; the screens' fixture host is in it. */
export const FAKE_ORGANIZATION_ID = "org-1";

export function braidsApiFake() {
  const state: BraidsApiState = {
    project: { intoOtherProjects: [], fromOtherProjects: [] },
    organization: [],
    keptToAdmins: false,
    braidsEnabled: true,
    policyFails: false,
    policyLoading: false,
    policyRefreshFails: false,
    pendingSave: undefined,
    policyRefetch: vi.fn(),
    remove: vi.fn(),
    setPolicy: vi.fn(),
    setEnabled: vi.fn(),
    targets: [],
    targetsFail: false,
    targetsRefetch: vi.fn(),
    targetsAsked: vi.fn(),
    viewers: { count: 0, exact: true },
    readerSigning: null,
    create: vi.fn(),
    change: vi.fn(),
    saveError: undefined,
  };
  const mutation = (
    record: () => Mock<(input: unknown) => void>,
    answer: (input: never) => unknown,
    pending: () => boolean = () => false,
  ) => ({
    useMutation: (options: MutationOptions) => ({
      isPending: pending(),
      mutate: (input: never) => {
        record()(input);
        if (state.saveError) options.onError?.(state.saveError);
        else options.onSuccess?.(answer(input));
      },
    }),
  });
  const query = (read: () => unknown) => ({
    useQuery: () => {
      const data = read();
      return { data, isLoading: false, isError: false };
    },
  });
  const asked = (read: () => unknown, record?: () => Mock<(input: unknown) => void>) => ({
    useQuery: (input: unknown, options?: { enabled?: boolean }) => {
      const enabled = options?.enabled !== false;
      if (enabled) record?.()(input);
      return { data: enabled ? read() : undefined, isLoading: false, isError: false };
    },
  });
  const saved = (input: { readerProjectId: string; braidId?: string }) =>
    liveBraid({ braidId: input.braidId ?? "b-new", readerProjectId: input.readerProjectId });
  const api = {
    useUtils: () => ({
      authz: {
        listBraids: { invalidate: vi.fn() },
        listOrganizationBraids: { invalidate: vi.fn() },
        getBraidsPolicy: {
          setData: (
            input: { organizationId: string },
            policy: { braidsOrganizationAdminsOnly: boolean; braidsEnabled: boolean },
          ) => {
            // The fake holds one organisation's policy: a write to any other is a wrong key.
            expect(input).toEqual({ organizationId: FAKE_ORGANIZATION_ID });
            state.keptToAdmins = policy.braidsOrganizationAdminsOnly;
            state.braidsEnabled = policy.braidsEnabled;
          },
        },
      },
    }),
    authz: {
      listBraids: query(() => state.project),
      listOrganizationBraids: query(() => state.organization),
      getBraidsPolicy: {
        useQuery: ({ organizationId }: { organizationId: string }) => {
          const refetch = state.policyRefetch;
          if (state.policyLoading)
            return { data: undefined, isLoading: true, isError: false, refetch };
          if (state.policyFails || organizationId !== FAKE_ORGANIZATION_ID)
            return { data: undefined, isLoading: false, isError: true, refetch };
          return {
            data: {
              organizationId,
              braidsOrganizationAdminsOnly: state.keptToAdmins,
              braidsEnabled: state.braidsEnabled,
              updatedByUserId: null,
              updatedAtMs: null,
            },
            isLoading: false,
            isError: state.policyRefreshFails,
            refetch,
          };
        },
      },
      removeBraid: mutation(
        () => state.remove,
        (input: { braidId: string }) => ({ braidId: input.braidId }),
      ),
      listBraidTargets: {
        useQuery: (input: unknown, options?: { enabled?: boolean }) => {
          const enabled = options?.enabled !== false;
          if (enabled) state.targetsAsked(input);
          const refetch = state.targetsRefetch;
          if (enabled && state.targetsFail) {
            return { data: undefined, isLoading: false, isError: true, refetch };
          }
          const data = enabled ? state.targets : undefined;
          return { data, isLoading: false, isError: false, refetch };
        },
      },
      countProjectTraceViewers: asked(() => state.viewers),
      createBraid: mutation(() => state.create, saved),
      changeBraid: mutation(() => state.change, saved),
      setBraidsPolicy: mutation(
        () => state.setPolicy,
        (input: { organizationId: string; braidsOrganizationAdminsOnly: boolean }) => ({
          organizationId: input.organizationId,
          braidsOrganizationAdminsOnly: input.braidsOrganizationAdminsOnly,
          braidsEnabled: state.braidsEnabled,
          updatedByUserId: "u-ana",
          updatedAtMs: 1,
        }),
        () => state.pendingSave === "policy",
      ),
      setBraidsEnabled: mutation(
        () => state.setEnabled,
        (input: { organizationId: string; braidsEnabled: boolean }) => ({
          organizationId: input.organizationId,
          braidsOrganizationAdminsOnly: state.keptToAdmins,
          braidsEnabled: input.braidsEnabled,
          updatedByUserId: "u-ana",
          updatedAtMs: 1,
        }),
        () => state.pendingSave === "enabled",
      ),
    },
  };
  return {
    api: { ...api, signingKeys: { projectSigning: asked(() => state.readerSigning) } },
    state,
  };
}

export function braidTraceFake() {
  const state: BraidTraceState = {
    preview: previewOf({ traces: { every: 0, some: 0, none: 0, total: 0, capped: false } }),
    previewAsked: vi.fn(),
    attributeKeys: [],
    activity: [],
    testTrace: { found: false, nodes: [] },
    testTraceAsked: vi.fn(),
  };
  const asked = (
    read: () => unknown,
    record?: Mock<(input: unknown) => void>,
    fails: () => boolean = () => false,
  ) => ({
    useQuery: (input: unknown, options?: { enabled?: boolean }) => {
      const enabled = options?.enabled !== false;
      if (enabled) record?.(input);
      const isError = enabled && fails();
      return { data: enabled && !isError ? read() : undefined, isLoading: false, isError };
    },
  });
  const traceClient = {
    traces: {
      braidPreview: asked(() => state.preview, state.previewAsked),
      braidAttributeKeys: asked(() => ({ keys: state.attributeKeys })),
      braidActivity: asked(
        () => (Array.isArray(state.activity) ? { activity: state.activity } : undefined),
        undefined,
        () => state.activity === "failed",
      ),
      braidTestTrace: asked(() => state.testTrace, state.testTraceAsked),
    },
  };
  return { traceClient, state };
}

/** A preview answer with no live braids on the pair and no example unless given. */
export function previewOf(
  overrides: Partial<BraidTraceState["preview"]> & { traces: PreviewTraces },
): BraidTraceState["preview"] {
  return {
    refusal: null,
    spans: 0,
    live: { braids: 0, traces: { ...overrides.traces, every: 0, some: 0 }, spans: 0 },
    unsignedHidden: null,
    example: null,
    ...overrides,
  };
}

export const braidTraces = braidTraceFake();

export const STRUCTURE = {
  organizationName: "Acme",
  teams: [{ id: "t-1", name: "Agents" }],
  projects: [
    { id: "p-orch", name: "orchestrator", teamId: "t-1" },
    { id: "p-spec", name: "specialists", teamId: "t-1" },
  ],
};

export function liveBraid(overrides: Partial<Braid> = {}): Braid {
  return {
    braidId: "b-1",
    ownerProjectId: "p-spec",
    readerProjectId: "p-orch",
    where: 'attributes["orchestrator"] == "web"',
    fromMs: Date.UTC(2026, 9, 1),
    expiresAtMs: Date.UTC(2026, 11, 31),
    createdByUserId: "u-ana",
    createdAtMs: Date.UTC(2026, 9, 2),
    ...overrides,
  };
}

export const braidsFake = braidsApiFake();
