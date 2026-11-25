// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/** The metadata fields every cloud agent lister writes the same way. */

import { Temporal } from "@langwatch/time";

/** The owner a cloud label names: `owner`, else `Owner`, else `team`; "" when none does. */
export function ownerLabelOf({ labels }: { labels: Record<string, string> }): string {
  return labels.owner ?? labels.Owner ?? labels.team ?? "";
}

/** A provider timestamp as millisecond ISO text; "" when absent or unreadable. */
export function isoMomentText({ value }: { value: string | undefined }): string {
  if (!value) return "";
  try {
    return Temporal.Instant.from(value).toString({
      fractionalSecondDigits: 3,
      roundingMode: "trunc",
    });
  } catch {
    return "";
  }
}

/** The metadata fields that carry a value; an empty one is left out so the stored value stays. */
export function definedMetadata(
  entries: Record<string, string | undefined>,
): Record<string, string> {
  const metadata: Record<string, string> = {};
  for (const [field, value] of Object.entries(entries)) {
    if (value !== undefined && value !== "") metadata[field] = value;
  }
  return metadata;
}
