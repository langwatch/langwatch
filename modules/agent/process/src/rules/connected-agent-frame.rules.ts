/**
 * What one message off a connected instance's socket is. A result frame that
 * fails the schema still names its call, so that call can fail at once.
 * @see specs/agents/connected-agents.feature
 */
import { resultFrameSchema, type SdkFrame, sdkFrameSchema } from "@langwatch/agent-contract";
import type { z } from "zod";

/** The start of the error a call fails with when its result fails the schema. */
export const UNREADABLE_RESULT_MESSAGE = "the agent answered a result LangWatch cannot read";

export type SdkFrameRead =
  | { kind: "frame"; frame: SdkFrame }
  /** A result under a call id that fails the schema: the call can be failed. */
  | { kind: "unreadable_result"; callId: string; issue: string }
  /** Not JSON, or not a frame the platform knows: nothing to act on. */
  | { kind: "dropped" };

export function readSdkFrame(raw: string): SdkFrameRead {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { kind: "dropped" };
  }
  const parsed = sdkFrameSchema.safeParse(json);
  if (parsed.success) return { kind: "frame", frame: parsed.data };
  if (!namesResultCall(json)) return { kind: "dropped" };
  const { callId } = json;
  // The result schema on its own names the field that failed; the union of
  // every frame only says that no member matched.
  const result = resultFrameSchema.safeParse(json);
  if (result.success) return { kind: "frame", frame: result.data };
  return { kind: "unreadable_result", callId, issue: describeIssue(result.error.issues) };
}

function namesResultCall(json: unknown): json is { type: "result"; callId: string } {
  if (typeof json !== "object" || json === null) return false;
  if (!("type" in json) || json.type !== "result") return false;
  return "callId" in json && typeof json.callId === "string" && json.callId.length > 0;
}

type Leaf = Readonly<{ path: readonly PropertyKey[]; message: string }>;

/** The deepest issue as "path: message": in a union, the member that got furthest. */
function describeIssue(issues: readonly z.core.$ZodIssue[]): string {
  const deepest = leafIssues(issues, []).reduce<Leaf>(
    (best, leaf) => (leaf.path.length > best.path.length ? leaf : best),
    { path: [], message: issues[0]?.message ?? "Invalid input" },
  );
  const path = deepest.path.map(String).join(".");
  return path ? `${path}: ${deepest.message}` : deepest.message;
}

/** A union member's issue paths are relative to the union, so each is prefixed. */
function leafIssues(issues: readonly z.core.$ZodIssue[], prefix: readonly PropertyKey[]): Leaf[] {
  return issues.flatMap((issue) => {
    const path = [...prefix, ...issue.path];
    return issue.code === "invalid_union"
      ? issue.errors.flatMap((member) => leafIssues(member, path))
      : [{ path, message: issue.message }];
  });
}
