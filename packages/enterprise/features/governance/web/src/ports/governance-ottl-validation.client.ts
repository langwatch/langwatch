export type GovernanceOttlValidationError = {
  statementIndex: number;
  message: string;
  line: number;
  col: number;
};

export type GovernanceOttlValidationResult =
  | { status: "valid" }
  | { status: "invalid"; errors: GovernanceOttlValidationError[] }
  | { status: "deferred"; reason: string };

export abstract class GovernanceOttlValidationClient {
  abstract validate(input: {
    organizationId: string;
    statements: string[];
  }): Promise<GovernanceOttlValidationResult>;
}
