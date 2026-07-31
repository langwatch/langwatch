import {
  Badge,
  Box,
  Card,
  HStack,
  Spacer,
  Table,
  Text,
} from "@chakra-ui/react";
import type { ErrorCluster } from "~/server/app-layer/ops/types";

/**
 * Why lanes are parked, clustered by reason.
 *
 * Read-only on purpose. The park reason is the only failure text the dispatch
 * plane keeps, so a row names the failure but cannot say where it was thrown,
 * and a cluster is a group of reasons rather than a group of lanes — an
 * "unpark these" button here would have to widen to the whole lane kind to be
 * implementable, which is not what the row says. Recovery is per lane, in the
 * listing below, where the operator can see exactly what they are acting on.
 */
export function ParkedLanesCard({
  clusters,
  totalParked,
}: {
  clusters: ErrorCluster[];
  totalParked: number;
}) {
  if (clusters.length === 0) return null;

  return (
    <Card.Root>
      <Card.Body padding={0}>
        <HStack
          paddingX={4}
          paddingY={2.5}
          borderBottom="1px solid"
          borderBottomColor="border"
          gap={2}
          flexWrap="wrap"
        >
          <Text textStyle="sm" fontWeight="medium" color="red.500">
            Parked — {totalParked} lane{totalParked === 1 ? "" : "s"},{" "}
            {clusters.length} reason{clusters.length === 1 ? "" : "s"}
          </Text>
          <Spacer />
          <Text textStyle="xs" color="fg.muted">
            Search a reason below to unpark or drain the lanes behind it
          </Text>
        </HStack>

        <Table.ScrollArea maxHeight="360px">
          <Table.Root
            size="sm"
            variant="line"
            css={{ "& tr:last-child td": { borderBottom: "none" } }}
          >
            <Table.Header position="sticky" top={0} zIndex={1} bg="bg">
              <Table.Row>
                <Table.ColumnHeader width="60px" textAlign="end">
                  Lanes
                </Table.ColumnHeader>
                <Table.ColumnHeader>Reason</Table.ColumnHeader>
                <Table.ColumnHeader width="110px">Kind</Table.ColumnHeader>
                <Table.ColumnHeader>Sample lanes</Table.ColumnHeader>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {clusters.map((cluster) => (
                <Table.Row
                  key={`${cluster.laneKind}::${cluster.normalizedMessage}`}
                >
                  <Table.Cell textAlign="end">
                    <Text color="red.500" fontWeight="medium" textStyle="xs">
                      {cluster.count}
                    </Text>
                  </Table.Cell>
                  <Table.Cell>
                    <Text
                      textStyle="xs"
                      truncate
                      maxWidth="360px"
                      title={cluster.sampleMessage}
                    >
                      {cluster.sampleMessage}
                    </Text>
                  </Table.Cell>
                  <Table.Cell>
                    <Badge size="xs" variant="subtle">
                      {cluster.laneKind}
                    </Badge>
                  </Table.Cell>
                  <Table.Cell>
                    <Text
                      textStyle="xs"
                      fontFamily="mono"
                      truncate
                      maxWidth="200px"
                      title={cluster.sampleLaneIds.join("\n")}
                    >
                      {cluster.sampleLaneIds.slice(0, 2).join(", ")}
                      {cluster.sampleLaneIds.length > 2
                        ? ` +${cluster.sampleLaneIds.length - 2}`
                        : ""}
                    </Text>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Root>
        </Table.ScrollArea>

        <Box paddingX={4} paddingY={2}>
          <Text textStyle="xs" color="fg.muted">
            Reasons are capped at the 20 largest clusters.
          </Text>
        </Box>
      </Card.Body>
    </Card.Root>
  );
}
