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

/** The two target reads the rules dialog makes, answered from {@link TARGETS} at once. */
export function directoryApi() {
  return {
    ops: {
      findFeatureFlagTargets: {
        useQuery: (
          input: { organizationIds: string[]; projectIds: string[]; userIds: string[] },
          options: { enabled: boolean },
        ) => ({
          isLoading: false,
          data: options.enabled
            ? TARGETS.filter((target) =>
                (
                  ({
                    organization: input.organizationIds,
                    project: input.projectIds,
                    user: input.userIds,
                  }) as Record<OpsFeatureFlagTargetKind, string[]>
                )[target.kind].includes(target.id),
              )
            : undefined,
        }),
      },
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
