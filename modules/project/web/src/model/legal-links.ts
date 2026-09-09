/**
 * The legal documents, and what to call them.
 *
 * `platform/app`'s `utils/legalLinks`, moved: the home colophon is the reader
 * left on this side. The words matter as much as the URLs — people look for
 * "Terms" and "Privacy Policy", and "Legal" is a category, which is what you
 * offer when you do not want to say which document you mean.
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
