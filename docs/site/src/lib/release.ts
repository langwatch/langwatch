import { z } from "zod";

export const releaseSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  date: z.iso.date(),
  label: z.string(),
  summary: z.string().min(1),
  body: z.string(),
  href: z.string().startsWith("/self-hosting/releases#"),
  compare: z.url().startsWith("https://github.com/langwatch/langwatch/compare/"),
});

export type Release = z.infer<typeof releaseSchema>;
