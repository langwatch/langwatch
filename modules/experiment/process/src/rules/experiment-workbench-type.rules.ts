/** Only an evaluations-v3 experiment carries a workbench; any other type refuses workbench use. */
export function isEvaluationsWorkbench(experiment: { type: string }): boolean {
  return experiment.type === "EVALUATIONS_V3";
}
