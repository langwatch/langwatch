/** One sign-up confirmation link, addressed. */
export type SignUpVerificationLink = { email: string; verificationUrl: string };

/** The mail carrying a sign-up's confirmation link. The memory tier records only. */
export abstract class SignUpVerificationMailChannel {
  abstract sendVerificationLink(input: SignUpVerificationLink): Promise<void>;
}
