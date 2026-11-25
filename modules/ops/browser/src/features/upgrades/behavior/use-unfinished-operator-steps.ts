import { api } from "../../../behavior/ops-api.ts";
import { isFinished } from "../model/upgrade-labels.ts";

/** Operator steps of the running version not yet done; empty until read, and when not asked. */
export function useUnfinishedOperatorSteps({ enabled }: { enabled: boolean }) {
  const operator = api.ops.upgrade.listSteps.useQuery({ mode: "operator" }, { enabled });
  return (operator.data?.items ?? []).filter((step) => !isFinished(step.status));
}
