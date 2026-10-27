/**
 * Passes an account with our additional `issuer` field to Better Auth, whose
 * account type does not carry it (ADR-189), without widening the type.
 */
export const withAccountIssuer = <T extends object>(account: T): T => account;
