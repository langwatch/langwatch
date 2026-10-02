import type { OttlValidationResult } from "@langwatch/enterprise-governance-contract";

export type GovernanceOttlValidationResult = OttlValidationResult;

export abstract class GovernanceOttlValidationClient {
  abstract validate(input: {
    organizationId: string;
    statements: string[];
  }): Promise<GovernanceOttlValidationResult>;
}
