import React from "react";
import { useRouter } from "next/router";
import { VStack, Grid, Card, Button, Text, Icon, Box } from "@chakra-ui/react";
import { OrganizationOnboardingContainer } from "../components/containers/OnboardingContainer";
import { BarChart2, CheckSquare, FileText, Cpu, Users } from "react-feather";

interface ProductOption {
  key: string;
  title: string;
  description: string;
  icon: React.ComponentType;
  href: string;
}

const options: ProductOption[] = [
  {
    key: "observability",
    title: "Observability",
    description: "Set up SDKs and start seeing traces and analytics.",
    icon: BarChart2,
    href: "/onboarding/product/observability",
  },
  {
    key: "evaluations",
    title: "Evaluations",
    description: "Create and run evaluations to measure quality.",
    icon: CheckSquare,
    href: "/onboarding/product/evaluations",
  },
  {
    key: "prompt-management",
    title: "Prompt management",
    description: "Organize, version and iterate on prompts.",
    icon: FileText,
    href: "/onboarding/product/prompt-management",
  },
  {
    key: "agent-simulations",
    title: "Agent simulations",
    description: "Simulate scenarios and test agent behavior.",
    icon: Cpu,
    href: "/onboarding/product/agent-simulations",
  },
  {
    key: "team-setup",
    title: "Team setup",
    description: "Invite teammates and manage roles.",
    icon: Users,
    href: "/onboarding/product/team-setup",
  },
];

export const ProductDirectionScreen: React.FC = () => {
  const router = useRouter();

  function handleSelect(option: ProductOption) {
    void router.push(option.href);
  }

  return (
    <OrganizationOnboardingContainer
      title="How do you want to use LangWatch?"
      subTitle="Choose a starting point. You can explore the rest anytime."
    >
      <VStack gap={6} align="stretch">
        <Grid
          templateColumns={{ base: "1fr", md: "repeat(2, 1fr)" }}
          gap={4}
        >
          {options.map((opt) => (
            <Card.Root key={opt.key} asChild>
              <Box
                borderWidth="1px"
                borderRadius="md"
                p={4}
                display="flex"
                flexDirection="column"
                gap={3}
              >
                <Box display="flex" alignItems="center" gap={3}>
                  <Icon>
                    <opt.icon />
                  </Icon>
                  <Text textStyle="lg" fontWeight="semibold">
                    {opt.title}
                  </Text>
                </Box>
                <Text color="gray.500">{opt.description}</Text>
                <Box mt={2}>
                  <Button colorPalette="orange" onClick={() => handleSelect(opt)}>
                    Continue
                  </Button>
                </Box>
              </Box>
            </Card.Root>
          ))}
        </Grid>
      </VStack>
    </OrganizationOnboardingContainer>
  );
};

export default ProductDirectionScreen;


