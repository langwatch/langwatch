/**
 * The Backoffice resource vocabulary, kept out of the screen so `ops.ts` can
 * publish it without statically importing a screen it also loads lazily --
 * that pair is what kept every ops screen in the browser's main chunk.
 */

/** The resources the Backoffice serves, in the order the sidebar lists them. */
export const BACKOFFICE_RESOURCES = [
  "users",
  "organizations",
  "projects",
  "subscriptions",
  "sso-connections",
  "bug-reports",
  "licenses",
  "self-hosted-instances",
  "identity-lookup",
] as const;

export type BackofficeResource = (typeof BACKOFFICE_RESOURCES)[number];
