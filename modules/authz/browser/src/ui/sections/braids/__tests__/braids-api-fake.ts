// The authz api as the Braids screens use it, answering from a test's state and recording writes.

import { type Mock, vi } from "vitest";

type MutationOptions = {
  onSuccess?: (data: unknown) => void;
  onError?: (error: unknown) => void;
};

type Braid = {
  braidId: string;
  ownerProjectId: string;
  readerProjectId: string;
  where: string | null;
  fromMs: number;
  expiresAtMs: number | null;
  createdByUserId: string | null;
  createdAtMs: number;
};

export type BraidsApiState = {
  project: { intoOtherProjects: Braid[]; fromOtherProjects: Braid[] } | undefined;
  organization: Braid[] | undefined;
  keptToAdmins: boolean;
  remove: Mock<(input: unknown) => void>;
  setPolicy: Mock<(input: unknown) => void>;
  targets: { projectId: string; selectable: boolean; reason?: "this_project" | "aggregate" }[];
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
  activity: { braidId: string; spanCount: number }[] | undefined;
  testTrace: { found: boolean; nodes: unknown[] };
  testTraceAsked: Mock<(input: unknown) => void>;
};

export function braidsApiFake() {
  const state: BraidsApiState = {
    project: { intoOtherProjects: [], fromOtherProjects: [] },
    organization: [],
    keptToAdmins: false,
    remove: vi.fn(),
    setPolicy: vi.fn(),
    targets: [],
    viewers: { count: 0, exact: true },
    readerSigning: null,
    create: vi.fn(),
    change: vi.fn(),
    saveError: undefined,
  };
  const mutation = (
    record: () => Mock<(input: unknown) => void>,
    answer: (input: never) => unknown,
  ) => ({
    useMutation: (options: MutationOptions) => ({
      isPending: false,
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
  const asked = (read: () => unknown) => ({
    useQuery: (_input: unknown, options?: { enabled?: boolean }) => {
      const enabled = options?.enabled !== false;
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
        getBraidsPolicy: { invalidate: vi.fn() },
      },
    }),
    authz: {
      listBraids: query(() => state.project),
      listOrganizationBraids: query(() => state.organization),
      getBraidsPolicy: query(() => ({
        organizationId: "org-1",
        braidsOrganizationAdminsOnly: state.keptToAdmins,
        updatedByUserId: null,
        updatedAtMs: null,
      })),
      removeBraid: mutation(
        () => state.remove,
        (input: { braidId: string }) => ({ braidId: input.braidId }),
      ),
      listBraidTargets: asked(() => state.targets),
      countProjectTraceViewers: asked(() => state.viewers),
      createBraid: mutation(() => state.create, saved),
      changeBraid: mutation(() => state.change, saved),
      setBraidsPolicy: mutation(
        () => state.setPolicy,
        (input: { braidsOrganizationAdminsOnly: boolean }) => ({
          organizationId: "org-1",
          braidsOrganizationAdminsOnly: input.braidsOrganizationAdminsOnly,
          updatedByUserId: "u-ana",
          updatedAtMs: 1,
        }),
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
  const asked = (read: () => unknown, record?: Mock<(input: unknown) => void>) => ({
    useQuery: (input: unknown, options?: { enabled?: boolean }) => {
      const enabled = options?.enabled !== false;
      if (enabled) record?.(input);
      return { data: enabled ? read() : undefined, isLoading: false, isError: false };
    },
  });
  const traceClient = {
    traces: {
      braidPreview: asked(() => state.preview, state.previewAsked),
      braidAttributeKeys: asked(() => ({ keys: state.attributeKeys })),
      braidActivity: asked(() => (state.activity ? { activity: state.activity } : undefined)),
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
