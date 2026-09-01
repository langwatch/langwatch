/**
 * The legal documents, and what to call them.
 *
 * One place because three surfaces link to them — the front door's fine print,
 * onboarding's agreement checkbox, and the home colophon — and they had drifted
 * into three different answers: two named documents, one generic "Legal"
 * index, and a checkbox that asked for agreement to Terms alone under a name
 * ("Terms of Service") the document does not use.
 *
 * The words matter as much as the URLs. People look for "Terms" and "Privacy
 * Policy"; "Legal" is a category, and a category is what you offer when you do
 * not want to say which document you mean.
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
