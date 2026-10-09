/**
 * The pure parts of the CLI device grant: the OAuth refusal and answer shapes,
 * the posted body, and the small decisions the flow's steps share.
 * @see specs/ai-gateway/governance/cli-login.feature
 */

import { HandledError } from "@langwatch/handled-error";
import { nowInstant } from "@langwatch/time";

import type { CliDeviceCodeRecord } from "../services/cli-device-session.service.ts";

/** One device-flow answer: the OAuth body the CLI parses. Refusals are thrown. */
export type CliDeviceFlowAnswer = Readonly<{ status: 200; body: unknown }>;

/**
 * Reduce a free-form device label to the charset a key name carries. Returns
 * null when nothing usable survives, so a caller falls back to a random suffix
 * rather than naming every machine the same.
 */
export function normalizeDeviceLabel(raw: string | undefined | null): string | null {
  if (!raw) return null;

  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .slice(0, 24)
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return cleaned.length > 0 ? cleaned : null;
}

/** Whether the grant behind a device code has already run out of time. */
export function expired(record: CliDeviceCodeRecord): boolean {
  return nowInstant().epochMilliseconds > record.expires_at;
}

/** The posted document, or an empty one where the body was not a JSON object. */
export function posted(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return {};
  }
}

/** Each directory read's own not-found code, and nothing else. */
export function isPersonOrOrganizationGone(error: unknown): boolean {
  return (
    HandledError.isHandled(error) &&
    (error.code === "user_not_found" || error.code === "organization_not_found")
  );
}

export function isProjectGone(error: unknown): boolean {
  return HandledError.isHandled(error) && error.code === "project_not_found";
}

/** A JSON body this family writes itself, exactly as its clients read it. */
export function answer(body: unknown): CliDeviceFlowAnswer {
  return { status: 200, body };
}

export function withManagement(
  permissions: readonly string[],
  management: readonly string[],
): string[] {
  return [...new Set([...permissions, ...management])];
}
