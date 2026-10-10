import { formatCost, formatTokens } from "@langwatch/design-system/display-formatters";
import { FormattedNumber } from "@langwatch/design-system/formatted-number";
import { ListTable } from "@langwatch/design-system/list-table";
import { Table } from "@langwatch/design-system/primitives";
import numeral from "numeral";
import type React from "react";

import { type DetailPayload } from "../../model/pull-request-detail.ts";
import { AgentLabel } from "../elements/agent-label.tsx";
import { MISSING_VALUE } from "../elements/cells/missing-value.tsx";
import { ContributorName } from "../elements/contributor-name.tsx";
import { EmptySection, Section } from "../elements/detail-section.tsx";

/** Who worked on the pull request, and what each of them consumed. */
export const ContributorsSection: React.FC<{
  contributors: DetailPayload["contributors"];
}> = ({ contributors }) => (
  <Section title="Contributors">
    {contributors.length === 0 ? (
      <EmptySection>No sessions ran on this pull request yet</EmptySection>
    ) : (
      <ListTable size="sm" containerProps={{ overflowX: "auto" }}>
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader>Contributor</Table.ColumnHeader>
            <Table.ColumnHeader>Agent</Table.ColumnHeader>
            <Table.ColumnHeader textAlign="end">Sessions</Table.ColumnHeader>
            <Table.ColumnHeader textAlign="end">Tokens</Table.ColumnHeader>
            <Table.ColumnHeader textAlign="end">Token cost</Table.ColumnHeader>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {contributors.map((contributor) => (
            <Table.Row key={`${contributor.projectId} ${contributor.agent}`}>
              <ContributorName contributor={contributor} />
              <Table.Cell fontSize="sm" color="fg.muted">
                {contributor.agent ? <AgentLabel agent={contributor.agent} /> : MISSING_VALUE}
              </Table.Cell>
              <Table.Cell textAlign="end" fontSize="sm">
                {numeral(contributor.sessionsCount).format("0,0")}
              </Table.Cell>
              <Table.Cell textAlign="end" fontSize="sm">
                <FormattedNumber value={contributor.totalTokens} unit="tokens">
                  {formatTokens(contributor.totalTokens)}
                </FormattedNumber>
              </Table.Cell>
              <Table.Cell textAlign="end" fontSize="sm">
                {contributor.costUsd === null ? (
                  MISSING_VALUE
                ) : (
                  <FormattedNumber value={contributor.costUsd} currency="USD">
                    {formatCost(contributor.costUsd)}
                  </FormattedNumber>
                )}
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </ListTable>
    )}
  </Section>
);
