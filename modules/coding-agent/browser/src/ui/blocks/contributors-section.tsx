import { formatCost, formatTokens } from "@langwatch/design-system/display-formatters";
import { FormattedNumber } from "@langwatch/design-system/formatted-number";
import { ListTable } from "@langwatch/design-system/list-table";
import { type EmptyNext, NoDataInfoBlock } from "@langwatch/design-system/no-data-info-block";
import numeral from "numeral";
import type React from "react";

import { type DetailPayload } from "../../model/pull-request-detail.ts";
import { AgentLabel } from "../elements/agent-label.tsx";
import { MISSING_VALUE } from "../elements/cells/missing-value.tsx";
import { ContributorName } from "../elements/contributor-name.tsx";
import { Section } from "../elements/detail-section.tsx";

const SESSIONS_NEXT: EmptyNext = [
  {
    kind: "docs",
    label: "How pull requests are attributed",
    href: "https://docs.langwatch.ai/coding-agents/repository-and-pr-attribution",
  },
];

/** Who worked on the pull request, and what each of them consumed. */
export const ContributorsSection: React.FC<{
  contributors: DetailPayload["contributors"];
}> = ({ contributors }) => (
  <Section title="Contributors">
    {contributors.length === 0 ? (
      <NoDataInfoBlock
        size="line"
        title="No sessions ran on this pull request yet"
        next={SESSIONS_NEXT}
      />
    ) : (
      <ListTable size="sm" containerProps={{ overflowX: "auto" }}>
        <ListTable.Header>
          <ListTable.Row>
            <ListTable.ColumnHeader>Contributor</ListTable.ColumnHeader>
            <ListTable.ColumnHeader>Agent</ListTable.ColumnHeader>
            <ListTable.ColumnHeader align="end">Sessions</ListTable.ColumnHeader>
            <ListTable.ColumnHeader align="end">Tokens</ListTable.ColumnHeader>
            <ListTable.ColumnHeader align="end">Token cost</ListTable.ColumnHeader>
          </ListTable.Row>
        </ListTable.Header>
        <ListTable.Body>
          {contributors.map((contributor) => (
            <ListTable.Row key={`${contributor.projectId} ${contributor.agent}`}>
              <ContributorName contributor={contributor} />
              <ListTable.Cell tone="muted">
                {contributor.agent ? <AgentLabel agent={contributor.agent} /> : MISSING_VALUE}
              </ListTable.Cell>
              <ListTable.Cell align="end">
                {numeral(contributor.sessionsCount).format("0,0")}
              </ListTable.Cell>
              <ListTable.Cell align="end">
                <FormattedNumber value={contributor.totalTokens} unit="tokens">
                  {formatTokens(contributor.totalTokens)}
                </FormattedNumber>
              </ListTable.Cell>
              <ListTable.Cell align="end">
                {contributor.costUsd === null ? (
                  MISSING_VALUE
                ) : (
                  <FormattedNumber value={contributor.costUsd} currency="USD">
                    {formatCost(contributor.costUsd)}
                  </FormattedNumber>
                )}
              </ListTable.Cell>
            </ListTable.Row>
          ))}
        </ListTable.Body>
      </ListTable>
    )}
  </Section>
);
