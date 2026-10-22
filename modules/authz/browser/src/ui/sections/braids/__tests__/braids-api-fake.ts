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
};

export function braidsApiFake() {
  const state: BraidsApiState = {
    project: { intoOtherProjects: [], fromOtherProjects: [] },
    organization: [],
    keptToAdmins: false,
    remove: vi.fn(),
    setPolicy: vi.fn(),
  };
  const mutation = (
    record: () => Mock<(input: unknown) => void>,
    answer: (input: never) => unknown,
  ) => ({
    useMutation: (options: MutationOptions) => ({
      isPending: false,
      mutate: (input: never) => {
        record()(input);
        options.onSuccess?.(answer(input));
      },
    }),
  });
  const query = (read: () => unknown) => ({
    useQuery: () => {
      const data = read();
      return { data, isLoading: false, isError: false };
    },
  });
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
  return { api, state };
}

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
