/** Resolve legacy slot labels without changing current variant identifiers. */
export const resolveExperimentVerdictLabel = ({
  label,
  variants,
}: {
  label: string;
  variants: string[];
}): string => {
  if (variants.includes(label)) return label;
  if (label === "A") return variants[0] ?? label;
  if (label === "B") return variants[1] ?? label;
  return label;
};
