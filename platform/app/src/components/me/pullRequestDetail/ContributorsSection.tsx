import { Table } from "@chakra-ui/react";
import numeral from "numeral";
import type React from "react";

import {
  formatCost,
  formatTokens,
} from "~/features/traces-v2/utils/formatters";

import { AgentLabel } from "../AgentLabel";
import { ContributorName } from "./ContributorName";
import { type DetailPayload, MISSING_VALUE } from "./detailPayload";
import { EmptySection, Section } from "./Section";

/** Who worked on the pull request, and what each of them consumed. */
export const ContributorsSection: React.FC<{
  contributors: DetailPayload["contributors"];
}> = ({ contributors }) => (
  <Section title="Contributors">
    {contributors.length === 0 ? (
      <EmptySection>No sessions ran on this pull request yet</EmptySection>
    ) : (
      <Table.ScrollArea>
        <Table.Root size="sm" variant="line">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>Contributor</Table.ColumnHeader>
              <Table.ColumnHeader>Agent</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">Sessions</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">Tokens</Table.ColumnHeader>
              <Table.ColumnHeader textAlign="end">
                Token cost
              </Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {contributors.map((contributor) => (
              <Table.Row key={`${contributor.projectId} ${contributor.agent}`}>
                <ContributorName contributor={contributor} />
                <Table.Cell fontSize="sm" color="fg.muted">
                  {contributor.agent ? (
                    <AgentLabel agent={contributor.agent} />
                  ) : (
                    MISSING_VALUE
                  )}
                </Table.Cell>
                <Table.Cell textAlign="end" fontSize="sm">
                  {numeral(contributor.sessionsCount).format("0,0")}
                </Table.Cell>
                <Table.Cell textAlign="end" fontSize="sm">
                  {formatTokens(contributor.totalTokens)}
                </Table.Cell>
                <Table.Cell textAlign="end" fontSize="sm">
                  {contributor.costUsd === null
                    ? MISSING_VALUE
                    : formatCost(contributor.costUsd)}
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      </Table.ScrollArea>
    )}
  </Section>
);
