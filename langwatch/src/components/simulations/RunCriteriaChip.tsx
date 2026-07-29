/**
 * Criteria summary chip for the run detail drawer header.
 *
 * Green when every success criterion was met, red otherwise. Hovering
 * reveals the full criteria breakdown — each met criterion with a check,
 * each unmet one with a cross — so the verdict is explorable without
 * scrolling to the results section.
 */

import { HStack, Icon, Text, VStack } from "@chakra-ui/react";
import { Check, X } from "lucide-react";
import { Chip } from "~/features/traces-v2/components/TraceDrawer/Chip";

function CriteriaList({
  title,
  color,
  icon,
  items,
}: {
  title: string;
  color: string;
  icon: typeof Check;
  items: string[];
}) {
  return (
    <VStack align="stretch" gap={1}>
      <Text
        textStyle="2xs"
        fontWeight="600"
        color={color}
        textTransform="uppercase"
        letterSpacing="wider"
      >
        {title} ({items.length})
      </Text>
      {items.map((criterion) => (
        <HStack key={criterion} gap={1.5} align="flex-start">
          <Icon as={icon} boxSize={3} color={color} marginTop="2px" flexShrink={0} />
          <Text textStyle="xs" color="fg">
            {criterion}
          </Text>
        </HStack>
      ))}
    </VStack>
  );
}

export function RunCriteriaChip({
  metCriteria,
  unmetCriteria,
}: {
  metCriteria: string[];
  unmetCriteria: string[];
}) {
  const met = metCriteria.length;
  const total = met + unmetCriteria.length;
  if (total === 0) return null;

  const rate = Math.round((met / total) * 100);

  return (
    <Chip
      label="Criteria"
      value={`${met}/${total}`}
      tone={unmetCriteria.length === 0 ? "green" : "red"}
      tooltip={
        <VStack
          align="stretch"
          gap={2}
          minWidth="220px"
          maxWidth="340px"
          paddingY={0.5}
        >
          {metCriteria.length > 0 && (
            <CriteriaList
              title="Met"
              color="green.fg"
              icon={Check}
              items={metCriteria}
            />
          )}
          {unmetCriteria.length > 0 && (
            <CriteriaList
              title="Unmet"
              color="red.fg"
              icon={X}
              items={unmetCriteria}
            />
          )}
          <Text textStyle="2xs" color="fg.muted">
            {rate}% of success criteria met
          </Text>
        </VStack>
      }
    />
  );
}
