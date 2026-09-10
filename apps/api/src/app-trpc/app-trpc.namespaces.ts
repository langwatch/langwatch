/**
 * Every tRPC namespace this process does NOT serve, one entry each, with what
 * the browser loses without it. A namespace leaves this list the moment its
 * module's transport is converted and the record's literal names it.
 */

/** One namespace this process cannot mount, and why. */
export type AbsentApiTrpcNamespace = Readonly<{
  namespace: string;
  /** The module whose transport has to be converted for it to come back. */
  module: string;
  /** What the browser cannot do while it is absent. */
  consequence: string;
}>;

const UNCONVERTED = "its transport is still written against the deleted tRPC builders";

/**
 * Ordered by module, so the boot report reads as a conversion queue rather
 * than an alphabet. Each line names the module a lane has to convert.
 */
export const ABSENT_API_TRPC_NAMESPACES = [
  {
    namespace: "analytics.charts",
    module: "analytics",
    consequence:
      "no charted read and no workbench query answers, though analytics.savedWorkbenchCharts does",
  },
  { namespace: "automation", module: "automation", consequence: "no trigger is listed or edited" },
  {
    namespace: "emailSuppression",
    module: "automation",
    consequence: "an unsubscribe link cannot be spent",
  },
  {
    namespace: "export",
    module: "export",
    consequence: "neither bulk export reports its progress",
  },
  {
    namespace: "experiments",
    module: "experiment",
    consequence: "the experiment workbench lists nothing",
  },
  {
    namespace: "governance",
    module: "enterprise-governance",
    consequence: "the governance console and the landing decision answer nothing",
  },
  {
    namespace: "activityMonitor",
    module: "enterprise-governance",
    consequence: "the activity monitor is empty",
  },
  { namespace: "aiTools", module: "enterprise-governance", consequence: "no AI tool is listed" },
  {
    namespace: "anomalyRules",
    module: "enterprise-governance",
    consequence: "no anomaly rule is listed",
  },
  {
    namespace: "departments",
    module: "enterprise-governance",
    consequence: "no department is listed",
  },
  {
    namespace: "ingestionKey",
    module: "enterprise-governance",
    consequence: "no ingestion key is minted",
  },
  {
    namespace: "ingestionSources",
    module: "enterprise-governance",
    consequence: "no ingestion source is listed",
  },
  {
    namespace: "ingestionTemplates",
    module: "enterprise-governance",
    consequence: "no ingestion template is listed",
  },
  {
    namespace: "personalDashboard",
    module: "enterprise-governance",
    consequence: "the personal dashboard reads nothing",
  },
  {
    namespace: "personalSessions",
    module: "enterprise-governance",
    consequence: "a person's own sessions are not listed",
  },
  {
    namespace: "personalVirtualKeys",
    module: "enterprise-governance",
    consequence: "a person's own gateway keys are not listed",
  },
  {
    namespace: "routingPolicy",
    module: "enterprise-governance",
    consequence: "no routing policy is readable",
  },
  {
    namespace: "sessionPolicy",
    module: "enterprise-governance",
    consequence: "no session policy is readable",
  },
  { namespace: "langy", module: "langy", consequence: "the conversation panel cannot open" },
  {
    namespace: "langyEgress",
    module: "langy",
    consequence: "the egress allow-list cannot be edited",
  },
  {
    namespace: "modelProvider",
    module: "model-provider",
    consequence: "no provider credential is listed or saved",
  },
  {
    namespace: "llmModelCost",
    module: "model-provider",
    consequence: "no model cost rule is readable",
  },
  { namespace: "translate", module: "model-provider", consequence: "nothing is translated" },
  { namespace: "ops", module: "ops", consequence: "the operator back office answers nothing" },
  {
    namespace: "bugReports",
    module: "ops",
    consequence: "the support inbox lists no filed report",
  },
  { namespace: "setupSkills", module: "langy", consequence: "no setup skill is listed" },
  {
    namespace: "suites",
    module: "suite",
    consequence: "no test suite, folder or suite run is listed",
  },
  {
    namespace: "traces",
    module: "trace",
    consequence: "the trace explorer lists nothing and watches nothing",
  },
  { namespace: "tracesV2", module: "trace", consequence: "the discover view lists nothing" },
  { namespace: "spans", module: "trace", consequence: "no span is read" },
  {
    namespace: "sharedTrace",
    module: "trace",
    consequence: "a shared trace link opens nothing",
  },
  {
    namespace: "traceEditOverlay",
    module: "trace",
    consequence: "no trace edit is applied",
  },
  { namespace: "workflow", module: "workflow", consequence: "no workflow is opened or saved" },
  {
    namespace: "optimization",
    module: "workflow",
    consequence: "the optimization studio answers nothing",
  },
] as const satisfies readonly AbsentApiTrpcNamespace[];

/** The sentence the boot report writes for one absent namespace. */
export function absentNamespaceReason(entry: AbsentApiTrpcNamespace): string {
  return (
    `API process serves no ${entry.namespace} tRPC namespace: ${UNCONVERTED} in the ` +
    `${entry.module} module, so ${entry.consequence}.`
  );
}
