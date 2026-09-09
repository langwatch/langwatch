export type AuthzRevocationReason = "revocation" | "offboard";

export abstract class AuthzRevocationTelemetryPort {
  abstract record(args: {
    organizationId: string;
    reason: AuthzRevocationReason;
    grantCount: number;
  }): void;
}
