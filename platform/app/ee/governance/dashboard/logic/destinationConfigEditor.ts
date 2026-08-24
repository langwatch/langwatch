import {
  type WebhookDestination,
  webhookDestinationSchema,
} from "@ee/governance/services/activity-monitor/destinationConfig.schema";

interface DestinationConfigEditorState {
  emailRecipients: string[];
  nonEmailDestinations: WebhookDestination[];
}

function destinationArray(raw: string): unknown[] {
  try {
    const parsed = JSON.parse(raw || "{}") as { destinations?: unknown };
    return Array.isArray(parsed?.destinations) ? parsed.destinations : [];
  } catch {
    return [];
  }
}

function repairableEmailRecipients(destination: unknown): string[] | null {
  if (!destination || typeof destination !== "object") return null;
  if ((destination as { type?: unknown }).type !== "email") return null;
  const to = (destination as { to?: unknown }).to;
  const recipients = Array.isArray(to) ? to : [to];
  return recipients.filter((recipient): recipient is string => {
    return typeof recipient === "string";
  });
}

export function parseDestinationConfigForEditor(
  raw: string,
): DestinationConfigEditorState {
  const emailRecipients: string[] = [];
  const nonEmailDestinations: WebhookDestination[] = [];
  for (const destination of destinationArray(raw)) {
    const recipients = repairableEmailRecipients(destination);
    if (recipients) {
      emailRecipients.push(...recipients);
      continue;
    }
    const webhook = webhookDestinationSchema.safeParse(destination);
    if (webhook.success) nonEmailDestinations.push(webhook.data);
  }
  return { emailRecipients, nonEmailDestinations };
}

export function emailRecipientsFromDestinationConfig(raw: string): string {
  return parseDestinationConfigForEditor(raw).emailRecipients.join("\n");
}

export function destinationConfigWithEmailRecipients(
  raw: string,
  recipientsText: string,
): string {
  const { nonEmailDestinations } = parseDestinationConfigForEditor(raw);
  const to = recipientsText
    .split(/[\n,]/)
    .map((address) => address.trim())
    .filter(Boolean);
  return JSON.stringify(
    {
      destinations: [
        ...nonEmailDestinations,
        ...(to.length ? [{ type: "email", to }] : []),
      ],
    },
    null,
    2,
  );
}
