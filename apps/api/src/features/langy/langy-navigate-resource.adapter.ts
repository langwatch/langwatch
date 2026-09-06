/**
 * Where each resource Langy can open is read, answered from this process's own
 * feature services. Eight of them meet here, which is why it is a composition
 * root file rather than a feature-package one.
 */

/*
 * Every lookup is tenancy-scoped (`projectId` is always in it), and the path it
 * answers with is the one that resource's own REST door hands out as
 * `platformUrl`. A miss is `null`, and the fallback drops the navigate.
 */
import type { AgentService } from "@langwatch/agent-contract";
import type { DatasetService } from "@langwatch/dataset-contract";
import type { EvaluatorService } from "@langwatch/evaluator-contract";
import type { ExperimentService } from "@langwatch/experiment-contract";
import { type LangyNavigateResourceKind, LangyNavigateResourcePort } from "@langwatch/langy-server";
import type { MonitorService } from "@langwatch/monitor-contract";
import type { PromptService } from "@langwatch/prompt-contract";
import type { SimulationService } from "@langwatch/scenario-contract";
import type { WorkflowService } from "@langwatch/workflow-contract";

import { agentDrawerPath } from "../agent/agent-platform-url.ts";

/**
 * The eight directories, each absent where this process composed none of it.
 */
export type ApiLangyNavigateResources = Readonly<{
  prompts?: PromptService | undefined;
  datasets?: DatasetService | undefined;
  workflows?: WorkflowService | undefined;
  experiments?: ExperimentService | undefined;
  monitors?: MonitorService | undefined;
  evaluators?: EvaluatorService | undefined;
  agents?: AgentService | undefined;
  simulations?: SimulationService | undefined;
}>;

export class ApiLangyNavigateResourceAdapter extends LangyNavigateResourcePort {
  static create(resolve: () => ApiLangyNavigateResources): ApiLangyNavigateResourceAdapter {
    return new ApiLangyNavigateResourceAdapter(resolve);
  }

  private constructor(private readonly resolve: () => ApiLangyNavigateResources) {
    super();
  }

  async tryLocate({
    projectId,
    kind,
    resourceId,
  }: {
    projectId: string;
    kind: LangyNavigateResourceKind;
    resourceId: string;
  }): Promise<string | null> {
    const services = this.resolve();
    switch (kind) {
      case "prompt": {
        // The playground with that prompt open AS A TAB. The editor drawer
        // stacks a form over the playground's own "no prompts open" empty
        // state, so the one surface built for reading a prompt and running it
        // is the surface the drawer covers.
        const prompt = await services.prompts?.tryGetPromptByIdOrHandle({
          idOrHandle: resourceId,
          projectId,
        });
        return prompt ? `/prompts?promptId=${encodeURIComponent(prompt.id)}` : null;
      }
      case "dataset": {
        const dataset = await services.datasets?.getBySlugOrId({
          slugOrId: resourceId,
          projectId,
        });
        return dataset ? `/datasets/${encodeURIComponent(dataset.id)}` : null;
      }
      case "workflow": {
        const workflow = await services.workflows?.getById({ id: resourceId, projectId });
        return workflow ? `/studio/${encodeURIComponent(workflow.id)}` : null;
      }
      case "experiment": {
        const experiment = await services.experiments?.tryGetById({ id: resourceId, projectId });
        if (!experiment) return null;
        // The experiment page resolves slug or id; the slug is what the app's
        // own links use.
        const target = experiment.slug || experiment.id;
        return `/experiments/${encodeURIComponent(target)}`;
      }
      case "monitor": {
        const monitor = await services.monitors?.tryGetMonitorById({
          id: resourceId,
          projectId,
        });
        return monitor
          ? `/online-evaluations?drawer.open=onlineEvaluation&drawer.monitorId=${encodeURIComponent(monitor.id)}`
          : null;
      }
      case "evaluator": {
        const evaluator = await services.evaluators?.tryGetById({ id: resourceId, projectId });
        return evaluator
          ? `/evaluators?drawer.open=evaluatorEditor&drawer.evaluatorId=${encodeURIComponent(evaluator.id)}`
          : null;
      }
      case "agent": {
        const agent = await services.agents?.getById({ id: resourceId, projectId });
        return agent ? agentDrawerPath({ agentId: agent.id, agentType: agent.type }) : null;
      }
      case "scenarioRun": {
        const run = await services.simulations?.tryGetScenarioRunData({
          projectId,
          scenarioRunId: resourceId,
        });
        return run
          ? `/simulations?drawer.open=scenarioRunDetail&drawer.scenarioRunId=${encodeURIComponent(resourceId)}`
          : null;
      }
    }
  }
}
