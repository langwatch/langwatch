// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { FoldProjectionStore } from "@langwatch/eventing";

import type { NurturingProjectUsageState } from "../rules/nurturing-project-usage.rules.ts";

/** The fold's version; a stored row of another version is re-folded from the owners' logs. */
export const NURTURING_PROJECT_USAGE_PROJECTION_VERSION = "2026-11-08" as const;

/** The reads over the project-usage rows, and the organization each row is placed in. */
export interface NurturingProjectUsageReadRepository {
  /** Records which organization the project is in, as placement answered; the fold never knows. */
  placeProject(input: Readonly<{ projectId: string; organizationId: string }>): Promise<void>;
  /** Every placed project's usage in the organization; empty when none was placed. */
  findForOrganization(
    input: Readonly<{ organizationId: string }>,
  ): Promise<NurturingProjectUsageState[]>;
}

/** Nurturing's own project-usage rows: the peer fold's store and the reads over them. */
export type NurturingProjectUsageRepository = FoldProjectionStore<NurturingProjectUsageState> &
  NurturingProjectUsageReadRepository;
