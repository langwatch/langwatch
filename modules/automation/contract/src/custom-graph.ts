import { z } from "zod";

/** The graph fields automation evaluation and list enrichment need. */
export type CustomGraph = {
  id: string;
  projectId: string;
  name: string;
  graph: unknown;
  filters: unknown;
};

export const customGraphNameRefSchema = z.object({ id: z.string(), name: z.string() });
export type CustomGraphNameRef = z.infer<typeof customGraphNameRefSchema>;
