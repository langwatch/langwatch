/**
 * The month's events by type (spans, logs, metrics, evaluations, experiments, scenarios),
 * each with its share of the month.
 * @see specs/licensing/usage-page.feature
 */

import { Card } from "@langwatch/design-system/card";
import { MeterBar } from "@langwatch/design-system/meter-bar";
import { Text } from "@langwatch/design-system/primitives";
import { SettingList, SettingRow } from "@langwatch/design-system/settings-card";
import type { UsageCategoryCount } from "@langwatch/entitlement-contract";
import numeral from "numeral";

import { categoryRows } from "../../model/usage-page-state.ts";

export function UsageTypesCard({ byCategory }: { byCategory: readonly UsageCategoryCount[] }) {
  return (
    <Card data-testid="usage-types-card" title="By type">
      <SettingList variant="boxed">
        {categoryRows(byCategory).map((row) => (
          <SettingRow
            key={row.category}
            label={row.label}
            hint={row.hint ?? undefined}
            data-testid="usage-type-row"
          >
            <MeterBar fillRatio={row.share} width="160px" height="6px" fillColor="orange.solid" />
            <Text
              textStyle="bodySm"
              fontWeight={600}
              fontVariantNumeric="tabular-nums"
              minWidth="70px"
              textAlign="end"
              data-testid={`usage-type-count-${row.category}`}
            >
              {numeral(row.count).format("0,0")}
            </Text>
          </SettingRow>
        ))}
      </SettingList>
    </Card>
  );
}
