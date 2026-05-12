import { createListCollection } from "@chakra-ui/react";

export const EXPIRATION_OPTIONS = [
  { label: "No expiration", value: "" },
  { label: "7 days", value: "7" },
  { label: "30 days", value: "30" },
  { label: "60 days", value: "60" },
  { label: "90 days", value: "90" },
  { label: "Custom...", value: "custom" },
];

export const expirationCollection = createListCollection({
  items: EXPIRATION_OPTIONS,
});

/** Mask the middle of a secret string for display. */
export function maskSecret(v: string): string {
  if (v.length <= 8) return "********";
  return `${v.slice(0, 4)}${"*".repeat(Math.min(v.length - 8, 32))}${v.slice(-4)}`;
}

/** Build a `.env` snippet from key/value entries. */
export function formatEnvLines(
  entries: Array<{ key: string; value: string; mask?: boolean }>,
): string {
  return entries
    .map(
      ({ key, value, mask }) => `${key}="${mask ? maskSecret(value) : value}"`,
    )
    .join("\n");
}

/** One-line summary of a role-binding set for table display. */
export function roleSummary(
  bindings: Array<{
    role: string;
    scopeType: string;
    scopeId: string;
  }>,
): string {
  if (bindings.length === 0) return "No permissions";
  const first = bindings[0]!;
  const scope =
    first.scopeType === "ORGANIZATION"
      ? "Org-wide"
      : first.scopeType === "TEAM"
        ? "Team"
        : "Project";
  const suffix = bindings.length > 1 ? ` +${bindings.length - 1} more` : "";
  return `${first.role} (${scope})${suffix}`;
}
