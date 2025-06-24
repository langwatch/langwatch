import {
  Box,
  Heading,
  VStack,
  HStack,
  Text,
  Link as ChakraLink,
  Icon,
} from "@chakra-ui/react";
import { LuBell, LuBot, LuCheckCheck, LuCircleDashed, LuDatabase, LuMessageCircle, LuWeight, LuWorkflow } from "react-icons/lu";
import { useIntegrationChecks } from "../IntegrationChecks";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { trackEventOnce } from "../../utils/tracking";
import NextLink from "next/link";
import React from "react";

interface IntegrationCheck {
  key: string;
  label: string;
  href: (slug: string) => string;
  event: string;
  isExternal?: boolean;
  icon: React.ElementType;
}

const checks: IntegrationCheck[] = [
  {
    key: "firstMessage",
    label: "Sync your first message",
    href: (slug: string) => `/${slug}/messages`,
    event: "integration_checks_first_message",
    icon: LuMessageCircle,
  },
  {
    key: "workflows",
    label: "Create your first workflow",
    href: (slug: string) => `/${slug}/workflows`,
    event: "integration_checks_first_workflow",
    icon: LuWorkflow,
  },
  {
    key: "simulations",
    label: "Create your first agent simulation",
    href: (slug: string) => `/${slug}/simulations`,
    event: "integration_checks_first_simulation",
    icon: LuBot,
  },
  {
    key: "evaluations",
    label: "Set up your first evaluation",
    href: (slug: string) => `/${slug}/evaluations`,
    event: "integration_checks_first_evaluation",
    icon: LuWeight,
  },
  {
    key: "triggers",
    label: "Set up an alert",
    href: () => `https://docs.langwatch.ai/features/triggers`,
    event: "integration_checks_first_alert",
    isExternal: true,
    icon: LuBell,
  },
  {
    key: "datasets",
    label: "Create a dataset from the messages",
    href: () => `https://docs.langwatch.ai/features/datasets`,
    event: "integration_checks_first_dataset",
    isExternal: true,
    icon: LuDatabase,
  },
];

interface IntegrationCheckItemProps {
  check: IntegrationCheck;
  done: boolean;
  href: string;
  onClick: () => void;
}

const IntegrationCheckItem: React.FC<IntegrationCheckItemProps> = ({ check, done, href, onClick }) => (
  <ChakraLink
    as={check.isExternal ? "a" : NextLink}
    href={href}
    target={check.isExternal ? "_blank" : undefined}
    rel={check.isExternal ? "noopener noreferrer" : undefined}
    display="flex"
    alignItems="center"
    gap={2}
    color={done ? "gray.900" : "gray.700"}
    onClick={onClick}
    aria-label={check.label + (check.isExternal ? ' (opens in a new tab)' : '')}
  >
    <Icon as={done ? LuCheckCheck : LuCircleDashed} color={done ? "green.500" : "gray.300"} boxSize={4} />
    <Text
      as="span"
      fontWeight={done ? "medium" : "normal"}
      fontSize="sm"
      textDecoration={done ? "none" : "underline"}
      textUnderlineOffset="2px"
      textDecorationThickness="1px"
      textDecorationStyle={done ? "solid" : "dashed"}
      textDecorationColor={done ? "gray.500" : "gray.700"}
    >
      {check.label}
    </Text>
  </ChakraLink>
);

const IntegrationChecksCard: React.FC = () => {
  const { project } = useOrganizationTeamProject();
  const integrationChecks = useIntegrationChecks();
  const slug = project?.slug ?? "";

  return (
    <Box minH="160px" boxShadow="sm" borderRadius="xl" bg="white" p={4}>
      <HStack mb={3} gap={2} alignItems="flex-start" justifyContent="flex-start">
        <Heading size="md" fontWeight="bold" textAlign="left">
          Integration checks
        </Heading>
      </HStack>
      <VStack align="start" gap={1} fontSize="sm">
        <HStack align="center" gap={2}>
          <span style={{ fontSize: "16px" }} role="img" aria-label="party popper">🎉</span>
          <Text fontWeight="medium" fontSize="sm" as="span">Create your new project</Text>
        </HStack>
        {checks.map((check) => {
          const done = Boolean(integrationChecks.data?.[check.key as keyof typeof integrationChecks.data]);
          const href = check.href(slug);
          return (
            <IntegrationCheckItem
              key={check.key}
              check={check}
              done={done}
              href={href}
              onClick={() => {
                if (check.event && project?.id) {
                  trackEventOnce(check.event, { project_id: project.id });
                }
              }}
            />
          );
        })}
      </VStack>
    </Box>
  );
};

export default IntegrationChecksCard;
