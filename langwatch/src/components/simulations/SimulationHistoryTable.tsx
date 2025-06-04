import { Card, Table, Text } from "@chakra-ui/react";
import { type ScenarioRunFinishedEvent } from "~/app/api/scenario-events/[[...route]]/schemas";
import { formatDistanceToNow } from "date-fns";

interface SimulationHistoryTableProps {
  history: ScenarioRunFinishedEvent[];
}

export function SimulationHistoryTable({
  history,
}: SimulationHistoryTableProps) {
  return (
    <Card.Root w="100%">
      <Card.Header>
        <Card.Title>Simulation History</Card.Title>
      </Card.Header>
      <Card.Body>
        <Table.Root>
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeader>Status</Table.ColumnHeader>
              <Table.ColumnHeader>Verdict</Table.ColumnHeader>
              <Table.ColumnHeader>Met Criteria</Table.ColumnHeader>
              <Table.ColumnHeader>Unmet Criteria</Table.ColumnHeader>
              <Table.ColumnHeader>Run Time</Table.ColumnHeader>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {history.map((event) => (
              <Table.Row key={event.scenarioRunId}>
                <Table.Cell>
                  <Text
                    color={
                      event.status === "SUCCESS"
                        ? "green.500"
                        : event.status === "FAILED"
                        ? "red.500"
                        : "gray.500"
                    }
                  >
                    {event.status}
                  </Text>
                </Table.Cell>
                <Table.Cell>
                  <Text
                    color={
                      event.results?.verdict === "success"
                        ? "green.500"
                        : event.results?.verdict === "failure"
                        ? "red.500"
                        : "yellow.500"
                    }
                  >
                    {event.results?.verdict || "N/A"}
                  </Text>
                </Table.Cell>
                <Table.Cell>
                  {event.results?.metCriteria.length || 0} criteria
                </Table.Cell>
                <Table.Cell>
                  {event.results?.unmetCriteria.length || 0} criteria
                </Table.Cell>
                <Table.Cell>
                  {formatDistanceToNow(event.timestamp || Date.now(), {
                    addSuffix: true,
                  })}
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table.Root>
      </Card.Body>
    </Card.Root>
  );
}
