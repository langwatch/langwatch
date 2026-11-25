export const MAIL_GATEWAY_NAMES = ["ses", "sendgrid", "smtp", "resend"] as const;

export type MailGatewayName = (typeof MAIL_GATEWAY_NAMES)[number];

/** Whether each gateway has the settings it needs to attempt a send. */
export type MailGatewayAvailability = Readonly<Record<MailGatewayName, boolean>>;

export type MailGatewayPick =
  | { gateway: MailGatewayName | null }
  | { refused: "unknown"; named: string }
  | { refused: "unconfigured"; wanted: MailGatewayName };

/**
 * The one place a gateway is chosen: a named `EMAIL_PROVIDER` is taken at its
 * word or refused; unnamed, SES then SendGrid are inferred, as main did.
 */
export function pickMailGateway({
  provider,
  available,
}: {
  provider: string | undefined;
  available: MailGatewayAvailability;
}): MailGatewayPick {
  const named = provider?.trim().toLowerCase();
  if (!named) {
    const inferred = (["ses", "sendgrid"] as const).find((name) => available[name]);
    return { gateway: inferred ?? null };
  }
  const gateway = MAIL_GATEWAY_NAMES.find((name) => name === named);
  if (!gateway) return { refused: "unknown", named };
  return available[gateway] ? { gateway } : { refused: "unconfigured", wanted: gateway };
}
