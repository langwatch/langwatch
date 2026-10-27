/**
 * One configured provider credential.
 * Placed in model to allow both behavior and ui modules to access it.
 */
export type ProviderCredentialOption = {
  id: string;
  modelProviderName: string;
  slot: string;
  disabledAt: string | null;
  healthStatus: string;
};
