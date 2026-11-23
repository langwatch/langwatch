/** Whether a person's account still exists: the creator check of the personal-key rule. */
export interface GatewayUserDirectoryChannel {
  /** False once the account is gone. A failed read throws, so an outage never reads as gone. */
  accountExists(input: { userId: string }): Promise<boolean>;
}
