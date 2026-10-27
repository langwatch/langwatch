/** What a mount reads off the request: the caller, and their address. */
export type AutomationTrpcTestContext = {
  actor: { id: string } | null;
  email?: string | null;
  address?: string | null;
};
