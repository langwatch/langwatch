import type { MailDeliveryView } from "@langwatch/notification-contract";

/**
 * No email at all: no gateway named and none half-configured. Only then can no account have
 * verified its address, so the platform-operator seed may take an unverified named user.
 */
export function isEmailUnconfigured({
  mail,
}: {
  mail: Pick<MailDeliveryView, "provider" | "misconfigured">;
}): boolean {
  return mail.provider === undefined && !mail.misconfigured;
}
