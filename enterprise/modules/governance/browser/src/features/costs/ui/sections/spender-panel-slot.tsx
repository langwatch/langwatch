// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { ADD_A_SOURCE, PROVIDER_REPORTED_BY_USER } from "../../model/cost-panel-copy.ts";
import { sampleSpenderRows } from "../../model/sample-lanes.ts";
import type { SpenderReadState, SpenderRow } from "../../model/spender-row.ts";
import { CostSpenderError, CostSpenderList } from "../blocks/cost-spender-panel.tsx";
import { CostPanelEmpty } from "../elements/cost-panel-empty.tsx";
import { CostPanel } from "../elements/cost-panel.tsx";

export type { SpenderReadState };

export function SpenderPanelSlot({
  spenders,
  showSample,
}: {
  spenders: SpenderReadState;
  showSample: boolean;
}) {
  const measured = spenders.rows !== null && spenders.rows.length > 0 ? spenders.rows : null;
  const invented = showSample;
  const rows = showSample ? sampleSpenderRows() : measured;

  return (
    <CostPanel title={PROVIDER_REPORTED_BY_USER} sample={invented}>
      <SpenderPanelBody rows={rows} spenders={spenders} />
    </CostPanel>
  );
}

function SpenderPanelBody({
  rows,
  spenders,
}: {
  rows: SpenderRow[] | null;
  spenders: SpenderReadState;
}) {
  if (rows) return <CostSpenderList rows={rows} />;
  // Only a real failure gets the failure state. A refusal falls through to the
  // empty state below, which says what the panel holds and what would fill it —
  // true of a declined read, where "try again" is advice that cannot work.
  if (spenders.isError && !spenders.refused) return <CostSpenderError onRetry={spenders.retry} />;
  return (
    <CostPanelEmpty
      unanswered={spenders.rows === null}
      what="Cost grouped by the user the provider reports. Shared-key activity may belong to more than one person."
      source="Fills once a cost source reports users. Spend without a reported user stays unattributed."
      action={ADD_A_SOURCE}
    />
  );
}
