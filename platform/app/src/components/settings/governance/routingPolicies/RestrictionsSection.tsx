import {
  Accordion,
  Badge,
  Box,
  Field,
  HStack,
  Text,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { ChevronDown } from "lucide-react";
import type { Control, UseFormRegister } from "react-hook-form";
import { useWatch } from "react-hook-form";

import { FieldInfoTooltip } from "~/components/ui/FieldInfoTooltip";

import {
  countRestrictions,
  RESTRICTION_DIMENSIONS,
  type RestrictionDimension,
  type RoutingPolicyFormValues,
} from "./routingPolicyForm";

const DIMENSION_COPY: Record<
  RestrictionDimension,
  { label: string; description: string; denyPlaceholder: string }
> = {
  tools: {
    label: "Tools",
    description:
      "Matched against the name of every tool a request offers the model.",
    denyPlaceholder: "^shell_.*\ndelete_user",
  },
  mcp: {
    label: "MCP servers",
    description:
      "Matched against the name and address of every MCP server a request names.",
    denyPlaceholder: "unapproved\\.example\\.com",
  },
  urls: {
    label: "Web addresses",
    description:
      "Matched against every address found anywhere in the request, including messages, system prompts and tool arguments.",
    denyPlaceholder: "internal\\.corp\\..*",
  },
  models: {
    label: "Models",
    description:
      "Matched against the model a request resolves to, after any name mapping, so a mapping cannot route around a rule here.",
    denyPlaceholder: "gpt-4o-search.*",
  },
};

/**
 * Deny and allow rules per dimension, collapsed when there are none.
 *
 * Collapsing is the empty-state behavior only. Hiding rules an operator has
 * already configured would be a footgun: a policy that refuses traffic should
 * say so where it is edited, so the trigger carries the count and the section
 * opens itself whenever anything is set.
 */
export function RestrictionsSection({
  control,
  register,
}: {
  control: Control<RoutingPolicyFormValues>;
  register: UseFormRegister<RoutingPolicyFormValues>;
}) {
  const values = useWatch({ control });
  const ruleCount = countRestrictions(values as RoutingPolicyFormValues);
  const openByDefault = ruleCount > 0 ? ["restrictions"] : [];

  return (
    <Accordion.Root collapsible width="full" defaultValue={openByDefault}>
      <Accordion.Item value="restrictions" width="full">
        <Accordion.ItemTrigger paddingY={2}>
          <HStack width="full" justify="space-between">
            <HStack gap={2}>
              <Text fontSize="sm" fontWeight="semibold">
                Restrictions
              </Text>
              {ruleCount > 0 && (
                <Badge size="sm" variant="surface">
                  {ruleCount} {ruleCount === 1 ? "rule" : "rules"}
                </Badge>
              )}
              <FieldInfoTooltip
                description="Patterns that decide what a request may reach. A request matching a deny pattern is refused before it costs anything. When a dimension has any allow pattern, a request must match one of them. Deny wins over allow."
                docHref="/ai-gateway/policy-rules"
              />
            </HStack>
            <Accordion.ItemIndicator>
              <ChevronDown size={16} />
            </Accordion.ItemIndicator>
          </HStack>
        </Accordion.ItemTrigger>
        <Accordion.ItemContent>
          <VStack align="stretch" gap={4} paddingTop={2} width="full">
            <Text fontSize="xs" color="fg.muted">
              One pattern per line. A pattern the platform cannot read refuses
              the request rather than letting it through.
            </Text>
            {RESTRICTION_DIMENSIONS.map((dimension) => (
              <Box key={dimension}>
                <Text fontSize="sm" fontWeight="medium" marginBottom={1}>
                  {DIMENSION_COPY[dimension].label}
                </Text>
                <Text fontSize="xs" color="fg.muted" marginBottom={2}>
                  {DIMENSION_COPY[dimension].description}
                </Text>
                <HStack gap={3} align="flex-start">
                  <Field.Root flex={1}>
                    <Field.Label fontSize="xs">Refuse</Field.Label>
                    <Textarea
                      rows={3}
                      fontFamily="mono"
                      fontSize="xs"
                      placeholder={DIMENSION_COPY[dimension].denyPlaceholder}
                      {...register(`restrictions.${dimension}.deny`)}
                    />
                  </Field.Root>
                  <Field.Root flex={1}>
                    <Field.Label fontSize="xs">Allow only</Field.Label>
                    <Textarea
                      rows={3}
                      fontFamily="mono"
                      fontSize="xs"
                      placeholder="Leave blank to allow anything not refused"
                      {...register(`restrictions.${dimension}.allow`)}
                    />
                  </Field.Root>
                </HStack>
              </Box>
            ))}
          </VStack>
        </Accordion.ItemContent>
      </Accordion.Item>
    </Accordion.Root>
  );
}
