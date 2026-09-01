import { Table } from "@chakra-ui/react";
import { AgentLabel } from "./agent-label";
import { MISSING_VALUE, type DetailPayload } from "./pull-request-detail";
import numeral from "numeral";
import type React from "react";

import { ListTable } from "@langwatch/design-system/list-table";
import { formatCost, formatTokens } from "@langwatch/design-system/display-formatters";

import { ContributorName } from "./contributor-name";
import { EmptySection, Section } from "./detail-section";

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
                {formatTokens(contributor.totalTokens)}
              </Table.Cell>
              <Table.Cell textAlign="end" fontSize="sm">
                {contributor.costUsd === null ? MISSING_VALUE : formatCost(contributor.costUsd)}
              </Table.Cell>
            </Table.Row>
          ))}
        </Table.Body>
      </ListTable>
    )}
  </Section>
);
