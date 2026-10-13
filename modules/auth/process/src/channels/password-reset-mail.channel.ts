/** One password-reset link, addressed. */
export type PasswordResetLink = { email: string; resetUrl: string };

/** The mail carrying a password-reset link. The memory tier records only. */
export abstract class PasswordResetMailChannel {
  abstract sendResetLink(input: PasswordResetLink): Promise<void>;
}
