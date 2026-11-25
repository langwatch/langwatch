/** What a mount reads off the request: the caller, and their address. */
export type LicensingTrpcTestContext = {
  actor: { id: string };
  email?: string | null;
};
