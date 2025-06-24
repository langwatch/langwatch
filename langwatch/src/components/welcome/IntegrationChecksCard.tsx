import {
  Box,
  Heading,
  VStack,
  HStack,
  Circle,
  Text,
  Link as ChakraLink,
  Icon,
} from "@chakra-ui/react";
import { LuBell, LuBot, LuCheckCheck, LuCircleDashed, LuDatabase, LuMessageCircle, LuWeight, LuWorkflow } from "react-icons/lu";
import { useIntegrationChecks } from "../IntegrationChecks";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { trackEventOnce } from "../../utils/tracking";
import NextLink from "next/link";
import type { IconType } from "react-icons/lib";

interface IntegrationCheck {
  key: string;
  label: string | React.ReactNode;
  href: (slug: string) => string;
  event: string;
  isExternal?: boolean;
  icon?: IconType;
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

const IntegrationChecksCard = () => {
  const { project } = useOrganizationTeamProject();
  const integrationChecks = useIntegrationChecks();
  const slug = project?.slug ?? "";

  return (
    <Box
      minH="160px"
      boxShadow="sm"
      borderRadius="xl"
      bg="white"
      p={4}
    >
      <HStack
        mb={3}
        gap={2}
        alignItems="flex-start"
        justifyContent="flex-start"
      >
        <Heading size="md" fontWeight="bold" textAlign="left">
          Integration checks
        </Heading>
      </HStack>
      <VStack align="start" gap={1} fontSize="sm">
        <HStack align="center" gap={2}>
          <span style={{ fontSize: "16px" }}>🎉</span>
          <Text fontWeight="medium" fontSize="sm" as="span">Create your new project</Text>
        </HStack>

        {checks.map((check) => {
          const done = Boolean(integrationChecks.data?.[check.key as keyof typeof integrationChecks.data]);
          const href = check.href(slug);

          return (
            <ChakraLink
              as={check.isExternal ? "a" : NextLink}
              href={href}
              target={check.isExternal ? "_blank" : void 0}
              rel={check.isExternal ? "noopener noreferrer" : void 0}
              key={check.key}
              display="flex"
              alignItems="center"
              gap={2}
              color={done ? "gray.900" : "gray.700"}
              onClick={() => {
                if (check.event && project?.id) {
                  trackEventOnce(check.event, { project_id: project.id });
                }
              }}
            >
              <Text as="span">
                {done ? (
                  <LuCheckCheck color="#22c55e" size={16} />
                ) : (
                  <LuCircleDashed color="#d1d5db" size={16} />
                )}
              </Text>
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
        })}
      </VStack>
    </Box>
  );
};

export default IntegrationChecksCard;
