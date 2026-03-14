import { slugify } from "../../../../utils/slugify";

/**
 * Generates a deterministic evaluator ID slug for custom SDK evaluations.
 * Produces IDs in the format `customeval_{slugified_name}`.
 */
export const evaluationNameAutoslug = (name: string) => {
  const autoslug = slugify(name || "unnamed", {
    lower: true,
    strict: true,
  }).replace(/[^a-z0-9]/g, "_");
  return `customeval_${autoslug}`;
};
