// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** Main's cost-screen figures: an absent amount is `null`, never `$0`. @see specs/governance/governance-cost-screen.feature */
import type {
  GovernanceCostDayRecord,
  GovernanceCostModelRow,
  GovernanceSpenderRow,
} from "@langwatch/enterprise-governance-contract";
import { nanoUsdToDecimalString } from "@langwatch/gateway-contract";
import { type Instant, Temporal } from "@langwatch/time";

import type {
  GovernanceCostModelGroup,
  GovernanceCostPeriodRecordGroup,
  GovernanceCostSpenderGroup,
} from "../repositories/governance-cost-rollup.repository.ts";

const DAY_MS = 86_400_000;

export interface GovernanceCostFigure {
  amountUsd: number | null;
  cellsWithoutAmount: number;
  currenciesWithoutUsdAmount: string[];
}

type FigureRow = {
  amountNanoUsd: number | null;
  cellsWithoutAmount: number;
  currenciesWithoutUsdAmount?: readonly string[];
};

function utcDay(at: Instant): string {
  return at.toString().slice(0, 10);
}

/** The trailing window ending today in UTC, both ends included. */
export function trailingCostWindow({ now, windowDays }: { now: Instant; windowDays: number }): {
  fromDay: string;
  toDay: string;
} {
  return {
    fromDay: utcDay(
      Temporal.Instant.fromEpochMilliseconds(now.epochMilliseconds - (windowDays - 1) * DAY_MS),
    ),
    toDay: utcDay(now),
  };
}

/** A figure is offered only when EVERY cell behind it carries a USD amount; a partial sum is refused. */
export function spenderFigure(rows: readonly FigureRow[]): GovernanceCostFigure {
  const cellsWithoutAmount = rows.reduce((count, row) => count + row.cellsWithoutAmount, 0);
  const currenciesWithoutUsdAmount = [
    ...new Set(rows.flatMap((row) => row.currenciesWithoutUsdAmount ?? [])),
  ].toSorted();
  const priced = rows.flatMap((row) => (row.amountNanoUsd === null ? [] : [row.amountNanoUsd]));
  if (priced.length === 0 || cellsWithoutAmount > 0) {
    return { amountUsd: null, cellsWithoutAmount, currenciesWithoutUsdAmount };
  }
  const totalNanoUsd = priced.reduce((sum, amount) => sum + BigInt(amount), 0n);
  return {
    amountUsd: Number(nanoUsdToDecimalString(totalNanoUsd)),
    cellsWithoutAmount,
    currenciesWithoutUsdAmount,
  };
}

/** What a record was for: the model and the agent the provider named. */
export function recordLabel({ model, agentId }: { model: string; agentId: string }): string {
  if (model === "" && agentId === "") return "Not named";
  if (agentId === "") return model;
  if (model === "") return agentId;
  return `${model} (${agentId})`;
}

/** Largest spend first; a withheld figure sinks below every stated one. */
export function periodRecordsFrom(
  groups: readonly GovernanceCostPeriodRecordGroup[],
): GovernanceCostDayRecord[] {
  return groups
    .map((group) => ({ label: recordLabel(group), ...spenderFigure([group]) }))
    .toSorted(
      (a, b) => (b.amountUsd ?? -1) - (a.amountUsd ?? -1) || a.label.localeCompare(b.label),
    );
}

/** Largest spend first, withheld figures last, ties by model name. */
export function modelRowsFrom(
  groups: readonly GovernanceCostModelGroup[],
): GovernanceCostModelRow[] {
  const rows = groups.map((group) => ({ model: group.model, ...spenderFigure([group]) }));
  return rows.toSorted((left, right) => {
    if (left.amountUsd === null && right.amountUsd === null) {
      return left.model.localeCompare(right.model);
    }
    if (left.amountUsd === null) return 1;
    if (right.amountUsd === null) return -1;
    if (right.amountUsd !== left.amountUsd) return right.amountUsd - left.amountUsd;
    return left.model.localeCompare(right.model);
  });
}

function spenderKey(provider: string, rawActorId: string): string {
  return `${provider}\u0000${rawActorId}`;
}

/** Named spenders labeled with the People screen's words; cells naming nobody fold into one last row. */
export function spenderRowsFrom({
  groups,
  people,
}: {
  groups: readonly GovernanceCostSpenderGroup[];
  people: readonly { provider: string; rawActorId: string; displayText: string }[];
}): GovernanceSpenderRow[] {
  const displayTextBySpender = new Map(
    people.map((person) => [spenderKey(person.provider, person.rawActorId), person.displayText]),
  );
  const named = groups.filter((group) => group.rawActorId !== "");
  const blank = groups.filter((group) => group.rawActorId === "");
  const rows: GovernanceSpenderRow[] = named
    .map((group) => ({
      provider: group.provider,
      rawActorId: group.rawActorId,
      label:
        displayTextBySpender.get(spenderKey(group.provider, group.rawActorId)) ?? group.rawActorId,
      agentId: group.agentId,
      ...spenderFigure([group]),
    }))
    .toSorted(
      (a, b) =>
        (b.amountUsd ?? -1) - (a.amountUsd ?? -1) || (a.label ?? "").localeCompare(b.label ?? ""),
    );
  if (blank.length === 0) return rows;
  return [
    ...rows,
    { provider: "", rawActorId: "", label: null, agentId: "", ...spenderFigure(blank) },
  ];
}
