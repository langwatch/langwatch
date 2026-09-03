import { Badge, Box, Button, Card, HStack, Text } from "@chakra-ui/react";
import { Skull } from "lucide-react";
import { formatTimeAgo } from "../../../../model/ops-formatters";
import type { DeadLetterProcessCount } from "../../model/dead-letter-types";

/**
 * Which processes are dead and how stale, doubling as the filter.
 *
 * One button per process rather than a dropdown: the breakdown IS the
 * diagnosis most of the time, and an operator mid-incident should not have to
 * open a control to read it.
 */
export function DeadLetterSummary({
  byProcess,
  selected,
  now,
  onSelect,
}: {
  byProcess: DeadLetterProcessCount[];
  selected: string | undefined;
  now: number;
  onSelect: (processName: string | undefined) => void;
}) {
  const fleetTotal = byProcess.reduce((sum, row) => sum + row.count, 0);
  return (
    <Card.Root>
      <Card.Body padding={4}>
        <HStack gap={2} marginBottom={3}>
          <Box color="red.500">
            <Skull size={16} />
          </Box>
          <Text textStyle="sm" fontWeight="medium" data-testid="dead-total">
            {fleetTotal} dead {fleetTotal === 1 ? "message" : "messages"} across{" "}
            {byProcess.length} {byProcess.length === 1 ? "process" : "processes"}
          </Text>
        </HStack>
        <HStack gap={2} flexWrap="wrap">
          <Button
            size="xs"
            variant={selected === undefined ? "solid" : "outline"}
            onClick={() => onSelect(undefined)}
          >
            All
          </Button>
          {byProcess.map((row) => (
            <Button
              key={row.processName}
              size="xs"
              data-testid={`dead-filter-${row.processName}`}
              variant={selected === row.processName ? "solid" : "outline"}
              onClick={() => onSelect(row.processName)}
            >
              {row.processName}
              <Badge size="xs" colorPalette="red" marginLeft={1}>
                {row.count}
              </Badge>
              {/* `as="span"`: Chakra's Text renders a <p>, which a <button>
                  may not contain — the browser closes the button early and
                  the chip stops being one control. */}
              <Text as="span" textStyle="xs" color="fg.muted" marginLeft={1}>
                oldest {formatTimeAgo(row.oldestUpdatedAt, now)}
              </Text>
            </Button>
          ))}
        </HStack>
      </Card.Body>
    </Card.Root>
  );
}
