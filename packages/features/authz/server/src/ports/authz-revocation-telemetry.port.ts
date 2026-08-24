export type AuthzRevocationReason = "revocation" | "offboard";

export abstract class AuthzRevocationTelemetry {
  abstract record(args: {
    organizationId: string;
    reason: AuthzRevocationReason;
    grantCount: number;
  }): void;
}
