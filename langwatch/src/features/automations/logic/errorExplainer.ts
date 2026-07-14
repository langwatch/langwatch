/**
 * Reads the structured `domainError` the server attaches via `errorFormatter`
 * (see `src/server/api/trpc.ts`) and translates each known `kind` into a
 * field-targeted toast. Pure — no React, no Chakra — so the UI just calls
 * `explainDomainError` with the `{ kind, meta, … }` shape and renders the
 * returned title/description.
 */

export interface DomainErrorShape {
  kind: string;
  meta: Record<string, unknown>;
  httpStatus: number;
}

/** Reads `error.data.domainError` from any tRPC client error, returning null
 *  when the cause was not one of our domain errors (e.g. an infrastructure
 *  failure or a Zod parse error). Validates the shape before returning so a
 *  malformed payload can't crash `explainDomainError` on `domain.meta.*`
 *  access — the helper trusts `unknown` input and a misconfigured server
 *  shouldn't take the UI with it. */
export function readDomainError(err: unknown): DomainErrorShape | null {
  const candidate = (err as { data?: { domainError?: unknown } })?.data
    ?.domainError;
  if (!candidate || typeof candidate !== "object") return null;

  const value = candidate as {
    kind?: unknown;
    meta?: unknown;
    httpStatus?: unknown;
  };
  if (typeof value.kind !== "string") return null;
  if (typeof value.httpStatus !== "number") return null;

  return {
    kind: value.kind,
    httpStatus: value.httpStatus,
    meta:
      value.meta && typeof value.meta === "object"
        ? (value.meta as Record<string, unknown>)
        : {},
  };
}

export interface DomainErrorExplanation {
  title: string;
  /** Empty string when there's nothing to add beyond the title. */
  description: string;
}

export function explainDomainError(
  domain: DomainErrorShape,
): DomainErrorExplanation {
  switch (domain.kind) {
    case "template_validation_error": {
      const field = String(domain.meta.field ?? "template");
      const syntax = String(domain.meta.syntaxError ?? "Invalid Liquid syntax");
      return { title: `Template "${field}" is invalid`, description: syntax };
    }
    case "recipient_not_in_team": {
      const recipient = String(domain.meta.recipient ?? "Recipient");
      const allowed = Array.isArray(domain.meta.teamEmails)
        ? (domain.meta.teamEmails as string[])
        : [];
      const suggestion = allowed.slice(0, 3).join(", ");
      const ellipsis = allowed.length > 3 ? "…" : "";
      return {
        title: "Recipient is not in the team",
        description: `${recipient} can't receive notifications.${suggestion ? ` Pick from: ${suggestion}${ellipsis}` : ""}`,
      };
    }
    case "missing_slack_webhook":
      return {
        title: "Slack webhook missing",
        description:
          "Paste a Slack incoming webhook URL in the Configuration step.",
      };
    case "missing_annotator":
      return {
        title: "Annotator missing",
        description: "Add at least one annotator to the queue.",
      };
    case "test_fire_unavailable": {
      const channel = String(domain.meta.channel ?? "destination");
      return {
        title: "Can't test-fire yet",
        description: `Configure the ${channel} destination first.`,
      };
    }
    case "project_not_found":
      return { title: "Project not found", description: "" };
    default:
      return { title: "Something went wrong", description: "" };
  }
}
