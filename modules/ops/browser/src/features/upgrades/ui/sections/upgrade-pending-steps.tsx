import { ListTable } from "@langwatch/design-system/list-table";
import { Button, Table } from "@langwatch/design-system/primitives";

import { releaseName } from "../../model/upgrade-labels.ts";
import type { UpgradeStepView } from "../../model/upgrade-view.ts";
import { UpgradeErrorSummary } from "../elements/upgrade-error-summary.tsx";
import { UpgradeStepState } from "../elements/upgrade-step-state.tsx";

/** Unfinished background or operator steps; a failed one offers Retry when one is given. */
export function UpgradePendingSteps({
  group,
  steps,
  onOpenStep,
  onRetryStep,
  retryingStepId,
}: {
  group: "background" | "operator";
  steps: readonly UpgradeStepView[];
  onOpenStep: (stepId: string) => void;
  onRetryStep?: (stepId: string) => void;
  retryingStepId?: string | null;
}) {
  const show = {
    release: steps.some((step) => step.release !== null),
    finishBy: steps.some((step) => step.finishBy !== null),
    error: steps.some((step) => step.lastError !== null),
    retry: onRetryStep !== void 0 && steps.some((step) => step.status === "failed"),
  };
  return (
    <ListTable
      density="compact"
      columnRules={false}
      containerProps={{ overflowX: "auto" }}
      data-testid={`upgrade-${group}-steps`}
    >
      <Table.Header>
        <Table.Row>
          <Table.ColumnHeader>Step</Table.ColumnHeader>
          <Table.ColumnHeader>Status</Table.ColumnHeader>
          {show.release && <Table.ColumnHeader>Release</Table.ColumnHeader>}
          {show.finishBy && <Table.ColumnHeader whiteSpace="nowrap">Finish by</Table.ColumnHeader>}
          {show.error && <Table.ColumnHeader>Last error</Table.ColumnHeader>}
          {show.retry && <Table.ColumnHeader aria-label="Actions" />}
        </Table.Row>
      </Table.Header>
      <Table.Body>
        {steps.map((step) => (
          <Table.Row
            key={step.id}
            cursor="pointer"
            onClick={() => onOpenStep(step.id)}
            data-testid={`upgrade-${group}-step-${step.id}`}
          >
            <Table.Cell fontFamily="mono" whiteSpace="nowrap" verticalAlign="top">
              {step.id}
            </Table.Cell>
            <Table.Cell verticalAlign="top">
              <UpgradeStepState step={step} />
            </Table.Cell>
            {show.release && (
              <Table.Cell fontFamily="mono" verticalAlign="top">
                {releaseName(step.release)}
              </Table.Cell>
            )}
            {show.finishBy && (
              <Table.Cell fontFamily="mono" verticalAlign="top">
                {step.finishBy}
              </Table.Cell>
            )}
            {show.error && (
              <Table.Cell maxWidth="420px" verticalAlign="top">
                {step.lastError && <UpgradeErrorSummary error={step.lastError} />}
              </Table.Cell>
            )}
            {show.retry && (
              <Table.Cell textAlign="end" verticalAlign="top">
                {step.status === "failed" && (
                  <Button
                    size="xs"
                    variant="outline"
                    loading={retryingStepId === step.id}
                    onClick={(event) => {
                      event.stopPropagation();
                      onRetryStep?.(step.id);
                    }}
                  >
                    Retry
                  </Button>
                )}
              </Table.Cell>
            )}
          </Table.Row>
        ))}
      </Table.Body>
    </ListTable>
  );
}
