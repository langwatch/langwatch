// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The state the ingestion-source drawers hold, with no markup attached.
 *
 * Spec: specs/ai-gateway/governance/ingestion-sources.feature
 * ADR-088 v7, Decisions 8-14.
 *
 * These are hooks, so they live in a `.ts` module rather than in the page
 * that renders them (CLAUDE.md: "Use `.ts` for hooks, `.tsx` for
 * components"). Keeping them here also lets a test drive the edit form
 * against the real picker without mounting the whole inventory page.
 */

import { useMemo } from "react";
import type { useGovernanceScope } from "../../behavior/governance-session";
import type { RouterOutputs } from "../../behavior/governance-api";
export type Source = RouterOutputs["ingestionSources"]["list"][number];

/**
 * The org's teams and projects, in the shape `ScopeChipPicker` reads. Both
 * drawers need it to offer a trace destination, and both get the same object
 * so the two pickers can never disagree about what exists.
 */
export interface DestinationContext {
  organizationId: string;
  organizationName?: string;
  availableTeams: Array<{ id: string; name: string }>;
  availableProjects: Array<{ id: string; name: string; teamId?: string }>;
}

/**
 * The projects a destination can be picked from: this organization's own,
 * named by team so two projects sharing a name stay distinguishable. Same
 * derivation the virtual-key drawer uses for the same column
 * (`VirtualKeyCreateDrawer.tsx:113-123`).
 */
export function useDestinationContext(
  organization: ReturnType<typeof useGovernanceScope>["organization"],
): DestinationContext {
  const orgId = organization?.id ?? "";
  return useMemo(
    () => ({
      organizationId: orgId,
      organizationName: organization?.name,
      availableTeams:
        organization?.teams?.map((t) => ({ id: t.id, name: t.name })) ?? [],
      availableProjects:
        organization?.teams?.flatMap((t) =>
          t.projects.map((p) => ({
            id: p.id,
            name: `${p.name} · ${t.name}`,
            teamId: t.id,
          })),
        ) ?? [],
    }),
    [orgId, organization],
  );
}
