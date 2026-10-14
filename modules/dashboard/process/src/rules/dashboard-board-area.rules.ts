/** Which boards a list keeps: the ones the Dashboards area opens, or the Reports boards alone. */
export type BoardArea = "dashboards" | "reports";

/** The area a list asks for: the Reports boards alone, the Dashboards area's, or every board. */
export function listedArea(input: {
  excludeLegacy?: boolean;
  onlyLegacy?: boolean;
}): BoardArea | "all" {
  if (input.onlyLegacy === true) return "reports";
  if (input.excludeLegacy === true) return "dashboards";
  return "all";
}
