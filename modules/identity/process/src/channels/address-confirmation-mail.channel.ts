/** One confirmation link, as identity hands it over: the ceremony's ids and raw token. */
export type AddressConfirmation = {
  email: string;
  identifierId: string;
  verificationId: string;
  token: string;
};

/**
 * The mail confirming an address somebody added to their own account. The link returns to the
 * page that started the ceremony, which holds the PKCE verifier. The memory tier records only.
 */
export abstract class AddressConfirmationMailChannel {
  abstract sendConfirmation(input: AddressConfirmation): Promise<void>;
}
