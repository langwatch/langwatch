import type {
  ListOrganizationSpendInput,
  ProjectSpendRollup,
} from "@langwatch/entitlement-contract";

/**
 * One organization's spend over a window, rolled up per project and narrowed
 * to the projects the caller can reach.
 */
export interface OrganizationSpendRepository {
  findSpendRollups(input: ListOrganizationSpendInput): Promise<ProjectSpendRollup[]>;
}
