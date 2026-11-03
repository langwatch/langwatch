import { z } from "zod";

export const releaseSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  date: z.iso.date(),
  label: z.string(),
  summary: z.string().min(1),
  body: z.string(),
  /** Its notes on the changelog page, or its GitHub release when the page has no room for it. */
  href: z.union([
    z.string().startsWith("/changelog#"),
    z.url().startsWith("https://github.com/langwatch/langwatch/releases/"),
  ]),
  compare: z.url().startsWith("https://github.com/langwatch/langwatch/compare/"),
});

export type Release = z.infer<typeof releaseSchema>;
