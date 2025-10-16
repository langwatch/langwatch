import React from "react";
import { useRouter } from "next/router";
import { VStack, Card, Text, Icon, Box, Grid, GridItem } from "@chakra-ui/react";
import { OrganizationOnboardingContainer } from "../components/containers/OnboardingContainer";
import { OnboardingMeshBackground } from "../components/OnboardingMeshBackground";
import { Telescope, Gavel, GraduationCap, HatGlasses } from "lucide-react";

interface ProductOption {
  key: string;
  title: string;
  description: string;
  icon: typeof Telescope;
  href: string;
}

const options: ProductOption[] = [
  {
    key: "observability",
    title: "Observability",
    description: "Set up SDKs and start seeing traces and analytics.",
    icon: Telescope,
    href: "/onboarding/product/observability",
  },
  {
    key: "evaluations",
    title: "Evaluations",
    description: "Create and run evaluations to measure quality.",
    icon: Gavel,
    href: "/onboarding/product/evaluations",
  },
  {
    key: "prompt-management",
    title: "Prompt Management",
    description: "Organize, version, iterate, and optimize your prompts.",
    icon: GraduationCap,
    href: "/onboarding/product/prompt-management",
  },
  {
    key: "agent-simulations",
    title: "Agent Simulations",
    description: "Simulate scenarios and test agent behavior.",
    icon: HatGlasses,
    href: "/onboarding/product/agent-simulations",
  },
];

export const ProductDirectionScreen: React.FC = () => {
  const router = useRouter();

  function handleSelect(option: ProductOption) {
    void router.push(option.href);
  }

  return (
    <OrganizationOnboardingContainer
      title="Pick your flavour"
      subTitle="Choose a starting point. You can explore the rest anytime."
    >
      <Box position="relative" minH="60vh">
        <OnboardingMeshBackground opacity={0.22} blurPx={96} />
        <Grid
          templateColumns="repeat(2, 1fr)"
          gap={4}
          position="relative"
          zIndex={1}
        >
          {options.map((opt) => (
            <GridItem key={opt.key}>
              <Card.Root asChild h="full">
                <Box
                  as="button"
                  w="full"
                  h="full"
                  borderWidth="1px"
                  borderColor="border.emphasized/40"
                  borderRadius="md"
                  p={6}
                  bg="bg.subtle/30"
                  backdropFilter="blur(10px)"
                  cursor="pointer"
                  transition="all 0.2s"
                  position="relative"
                  _hover={{
                    bg: "bg.subtle/70",
                    transform: "translateY(-2px)",
                    borderColor: "border.subtle/70",
                  }}
                  onClick={() => handleSelect(opt)}
                >
                  <VStack gap={3} align="center" h="full">
                    <Icon color="orange.500" size="lg">
                      <opt.icon strokeWidth={1.75} />
                    </Icon>
                    <VStack gap={1}>
                      <Text textStyle="lg" fontWeight="semibold" color="fg.emphasized" textAlign="center">
                        {opt.title}
                      </Text>
                      <Text fontSize="xs" color="fg.muted" textAlign="center" alignSelf="stretch" flex={1}>
                        {opt.description}
                      </Text>
                    </VStack>
                  </VStack>
                </Box>
              </Card.Root>
            </GridItem>
          ))}
        </Grid>
      </Box>
    </OrganizationOnboardingContainer>
  );
};

export default ProductDirectionScreen;


