/**
 * The choices the create and edit drawers offer, as data.
 *
 * Moved from `platform/app/src/pages/settings/api-keys/utils.ts`. The Chakra
 * `createListCollection` the platform module built beside this list did NOT
 * travel: a collection is a rendering concern, and a `model` module that
 * imports a component library is a layer inversion the drawer can avoid by
 * building its own from the same array.
 */

export const EXPIRATION_OPTIONS = [
  { label: "No expiration", value: "" },
  { label: "7 days", value: "7" },
  { label: "30 days", value: "30" },
  { label: "60 days", value: "60" },
  { label: "90 days", value: "90" },
  { label: "Custom...", value: "custom" },
];

/**
 * The date an expiration choice means, resolved against now.
 *
 * Extracted from the create drawer's `handleCreate` so the one branch that has
 * ever been wrong — a custom date parsed out of a date input, versus a preset
 * counted forward in days — is testable without rendering a drawer.
 */
export function resolveExpiresAt({
  preset,
  customDate,
  now = Date.now(),
}: {
  preset: string;
  customDate: string;
  now?: number;
}): Date | undefined {
  if (preset === "custom") return customDate ? new Date(customDate) : undefined;
  if (!preset) return undefined;
  const days = parseInt(preset, 10);
  if (Number.isNaN(days)) return undefined;
  return new Date(now + days * 24 * 60 * 60 * 1000);
}

/** The earliest day a custom expiration may name: tomorrow, in the reader's zone. */
export function earliestCustomExpiration(now: Date = new Date()): string {
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
