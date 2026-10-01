import { HandledError } from "@langwatch/handled-error";

/** The organization feature's refusal for a user who holds no membership row. */
export function isMemberNotFound(error: unknown): boolean {
  return HandledError.isHandled(error) && error.code === "member_not_found";
}

/** The organization feature's refusal for a group outside the organization asked about. */
export function isGroupNotFound(error: unknown): boolean {
  return HandledError.isHandled(error) && error.code === "group_not_found";
}
