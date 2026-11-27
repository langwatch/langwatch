/**
 * Each project's events this month, the busiest first, with its share of the month.
 * @see specs/licensing/usage-page.feature
 */

import { Card } from "@langwatch/design-system/card";
import { MeterBar } from "@langwatch/design-system/meter-bar";
import { Text } from "@langwatch/design-system/primitives";
import { SettingList, SettingRow } from "@langwatch/design-system/settings-card";
import type { ProjectUsageShare } from "@langwatch/entitlement-contract";
import numeral from "numeral";

import { projectShares } from "../../model/usage-page-state.ts";

export function UsageProjectsCard({ projects }: { projects: readonly ProjectUsageShare[] }) {
  const shares = projectShares(projects);
  return (
    <Card
      data-testid="usage-projects-card"
      title="By project"
      actions={
        <Text textStyle="bodySm" color="fg.muted">
          Same numbers as the limit email.
        </Text>
      }
    >
      <SettingList variant="boxed">
        {projects.map((project, index) => (
          <SettingRow key={project.projectId} label={project.name} data-testid="usage-project-row">
            <MeterBar
              fillRatio={shares[index] ?? 0}
              width="160px"
              height="6px"
              fillColor="orange.solid"
            />
            <Text
              textStyle="bodySm"
              fontWeight={600}
              fontVariantNumeric="tabular-nums"
              minWidth="70px"
              textAlign="end"
            >
              {numeral(project.count).format("0,0")}
            </Text>
          </SettingRow>
        ))}
      </SettingList>
    </Card>
  );
}
