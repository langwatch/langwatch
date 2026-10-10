import type { GroupInfo } from "@langwatch/ops-contract";

/** Browser-safe queue shapes consumed by Ops presentation components. */
export interface OpsPipelineNode {
  name: string;
  pending: number;
  active: number;
  blocked: number;
  children: OpsPipelineNode[];
}

/** The group fields needed for status, ordering, and recovery presentation. */
export type OpsQueueGroup = GroupInfo;
