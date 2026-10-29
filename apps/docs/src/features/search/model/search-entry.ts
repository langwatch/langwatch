import { z } from "zod/mini";

/** One rendered page's search entry, as the renderer produces and the render cache stores it. */
export const searchEntrySchema = z.object({
  slug: z.string(),
  method: z._default(z.string(), ""),
  title: z.string(),
  section: z.string(),
  description: z.string(),
  /** An icon name or image path: the page's own, else its group's, else its section's. */
  icon: z._default(z.string(), ""),
  trail: z._default(z.string(), ""),
  body: z._default(z.string(), ""),
  headings: z.array(z.object({ id: z.string(), text: z.string() })),
});
export type SearchEntry = z.infer<typeof searchEntrySchema>;
/** An entry as the renderer writes it, before defaults are applied. */
export type PublishedSearchEntry = z.input<typeof searchEntrySchema>;
