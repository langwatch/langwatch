import type {
  ContentCategory,
  DataPrivacyAudienceOptions,
  Disposition,
  PiiLevel,
} from "@langwatch/data-privacy-contract";
import { Building2, Folder, Users } from "lucide-react";

import type { AudienceFormState } from "./data-privacy-rule-config.ts";

/**
 * Labels for categories, dispositions, and PII levels; two PII maps because
 * summary and drawer use different words for the off level.
 */

export const CATEGORY_LABELS: Record<ContentCategory, string> = {
  input: "Input",
  output: "Output",
  system: "System instructions",
  tools: "Tool calls",
};

export const DISPOSITION_LABELS: Record<Disposition, string> = {
  capture: "Captured",
  restrict: "Restricted",
  drop: "Dropped",
};

/** How the effective-policy summary names a PII level. */
export const PII_LABELS: Record<PiiLevel, string> = {
  disabled: "Disabled",
  essential: "Essential",
  strict: "Strict",
  custom: "Custom",
};

/** How the drawer's inherited hint names a PII level. */
export const PII_VALUE_LABELS: Record<PiiLevel, string> = {
  disabled: "Off",
  essential: "Essential",
  strict: "Strict",
  custom: "Custom",
};

export const SCOPE_ICON: Record<string, typeof Building2> = {
  ORGANIZATION: Building2,
  DEPARTMENT: Users,
  TEAM: Users,
  PROJECT: Folder,
};

/** Human label for what an inherited control currently resolves to. */
export function inheritedHint(label: string): string {
  return `Inherits ${label}`;
}

/** The one line under the audience picker naming who can still read restricted content. */
export function describeAudienceSelection(
  audience: AudienceFormState,
  options: DataPrivacyAudienceOptions,
): string {
  const parts: string[] = [];
  if (audience.allMembers) parts.push("All members");
  if (audience.projectOwner) parts.push("project owners");
  if (audience.admins) parts.push("Admins");
  if (audience.members) parts.push("Members");
  if (audience.viewers) parts.push("Viewers");
  for (const id of audience.groupIds) {
    parts.push(options.groups.find((group) => group.id === id)?.name ?? "a group");
  }
  return parts.length > 0 ? `Visible to: ${parts.join(", ")}` : "No one (fully hidden)";
}
