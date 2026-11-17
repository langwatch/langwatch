import type { OpsFeatureFlagTarget, OpsFeatureFlagTargetKind } from "@langwatch/ops-contract";

/** Two organizations that share a name, told apart by slug, plan, members and age. */
export const TARGETS: OpsFeatureFlagTarget[] = [
  {
    kind: "organization",
    id: "organization_labs_old",
    name: "Acme Labs",
    slug: "acme-labs",
    createdAtMs: Date.UTC(2025, 1, 1),
    memberCount: 12,
    planName: "Growth",
    administratorEmails: ["owner@acme.test"],
  },
  {
    kind: "organization",
    id: "organization_labs_new",
    name: "Acme Labs",
    slug: "acme-labs-2",
    createdAtMs: Date.UTC(2026, 8, 1),
    memberCount: 1,
    planName: "Free",
    administratorEmails: ["trial@acme.test"],
  },
  {
    kind: "project",
    id: "project_checkout",
    name: "Checkout bot",
    slug: "checkout-bot",
    organization: { id: "organization_labs_old", name: "Acme Labs", slug: "acme-labs" },
  },
  {
    kind: "project",
    id: "project_support",
    name: "Support bot",
    slug: "support-bot",
    organization: { id: "organization_labs_old", name: "Acme Labs", slug: "acme-labs" },
  },
  {
    kind: "user",
    id: "user_dana",
    name: "Dana",
    email: "dana@acme.test",
    organizations: [{ id: "organization_labs_old", name: "Acme Labs", slug: "acme-labs" }],
  },
];

function matches(target: OpsFeatureFlagTarget, query: string): boolean {
  const needle = query.toLowerCase();
  const fields = [target.id, target.kind === "user" ? (target.email ?? "") : target.name];
  return fields.some((field) => field.toLowerCase().includes(needle));
}

/** Switches every stored-target read to failing, for the case where the lookup errors. */
export const directoryState = { failing: false };

/** What one stored-target read answers in tests. */
function storedTargets({
  input,
  enabled,
  failing,
}: {
  input: { organizationIds: string[]; projectIds: string[]; userIds: string[] };
  enabled: boolean;
  failing: boolean;
}) {
  const named = (kind: OpsFeatureFlagTargetKind) =>
    ({ organization: input.organizationIds, project: input.projectIds, user: input.userIds })[kind];
  return {
    isLoading: false,
    isError: enabled && failing,
    refetch: () => Promise.resolve(),
    data:
      enabled && !failing
        ? TARGETS.filter((target) => named(target.kind).includes(target.id))
        : undefined,
  };
}

/** The two target reads the rules dialog makes, answered from {@link TARGETS} at once. */
export function directoryApi() {
  return {
    useQueries: (
      build: (t: {
        ops: {
          findFeatureFlagTargets: (
            input: { organizationIds: string[]; projectIds: string[]; userIds: string[] },
            options: { enabled: boolean },
          ) => ReturnType<typeof storedTargets>;
        };
      }) => ReturnType<typeof storedTargets>[],
    ) =>
      build({
        ops: {
          findFeatureFlagTargets: (input, { enabled }) =>
            storedTargets({ input, enabled, failing: directoryState.failing }),
        },
      }),
    ops: {
      searchFeatureFlagTargets: {
        useQuery: (
          input: { kind: OpsFeatureFlagTargetKind; query: string },
          options: { enabled: boolean },
        ) => {
          const data = options.enabled
            ? TARGETS.filter((target) => target.kind === input.kind && matches(target, input.query))
            : undefined;
          return {
            data,
            isFetching: false,
            isError: false,
            isSuccess: data !== undefined,
            error: null,
          };
        },
      },
    },
  };
}
