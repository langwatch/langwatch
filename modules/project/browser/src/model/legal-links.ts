/**
 * The legal documents, and what to call them — moved from `platform/app`'s
 * `utils/legalLinks`. Words matter as much as URLs: people look for "Terms"
 * and "Privacy Policy"; "Legal" is a category, used when you don't want to say which.
 */
export const LEGAL_LINKS = {
  terms: {
    label: "Terms",
    href: "https://langwatch.ai/legal/terms-conditions",
  },
  privacy: {
    label: "Privacy Policy",
    href: "https://langwatch.ai/legal/privacy-policy",
  },
} as const;
