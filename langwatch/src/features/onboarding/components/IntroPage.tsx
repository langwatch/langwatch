import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { OrganizationOnboardingContainer } from "./OnboardingContainer";
import {
  Text,
  HStack,
  VStack,
  Field,
  Button,
  RadioCard,
  Icon,
  SegmentGroup,
  CheckboxCard,
  CheckboxGroup,
} from "@chakra-ui/react";
import { useState } from "react";
import {
  Building2,
  Cloud,
  Gavel,
  GraduationCap,
  LifeBuoy,
  Presentation,
  Server,
  StickyNote,
  Telescope,
  TestTubeDiagonal,
  User,
  Infinity as InfinityIcon,
  Code,
  BrainCircuit,
  PencilRuler,
  ChevronsLeftRightEllipsis,
  WandSparkles,
  ChefHat,
  Kayak,
  BadgeQuestionMark,
} from "lucide-react";
import React from "react";

const usageStyles = ["myself", "clients", "company"] as const;
const companySizes = [
  "starting_out",
  "2_to_10",
  "11_to_50",
  "51_to_200",
  "201_to_1000",
  "1000_plus",
] as const;
const solutionTypes = ["cloud", "on_premise"] as const;
const desires = [
  "everything",
  "evaluation",
  "model_experimentation",
  "prompt_management_optimization",
  "observability",
  "safety_compliance",
  "annotation",
  "just_exploring",
] as const;
const roles = [
  "product_manager",
  "software_engineer",
  "ai_engineer",
  "engineering_manager",
  "data_scientist",
  "ai_researcher",
  "cto_founder",
  "other",
] as const;

type UsageStyle = (typeof usageStyles)[number];
type CompanySize = (typeof companySizes)[number];
type SolutionType = (typeof solutionTypes)[number];
type Desire = (typeof desires)[number];
type Role = (typeof roles)[number];

const usageStyleItems: {
  title: string;
  icon: typeof User;
  value: UsageStyle;
}[] = [
  {
    title: "Company",
    value: "company",
    icon: Building2,
  },
  {
    title: "Clients",
    value: "clients",
    icon: Presentation,
  },
  {
    title: "Myself",
    value: "myself",
    icon: User,
  },
];

const companySizeItems: {
  title: string;
  value: CompanySize;
}[] = [
  {
    title: "Starting out",
    value: "starting_out",
  },
  {
    title: "2-10",
    value: "2_to_10",
  },
  {
    title: "11-50",
    value: "11_to_50",
  },
  {
    title: "51-200",
    value: "51_to_200",
  },
  {
    title: "201-1000",
    value: "201_to_1000",
  },
  {
    title: "1000+",
    value: "1000_plus",
  },
];

const solutionTypeItems: {
  title: string;
  value: SolutionType;
  icon: typeof Cloud;
}[] = [
  {
    title: "Cloud",
    value: "cloud",
    icon: Cloud,
  },
  {
    title: "On Premise",
    value: "on_premise",
    icon: Server,
  },
];

const desireItems: {
  title: string;
  value: Desire;
  icon: typeof Gavel;
}[] = [
  {
    title: "Evaluation",
    value: "evaluation",
    icon: Gavel,
  },
  {
    title: "Model Experimentation",
    value: "model_experimentation",
    icon: TestTubeDiagonal,
  },
  {
    title: "Prompt Management/Optimization",
    value: "prompt_management_optimization",
    icon: GraduationCap,
  },
  {
    title: "Observability",
    value: "observability",
    icon: Telescope,
  },
  {
    title: "Safety/Compliance",
    value: "safety_compliance",
    icon: LifeBuoy,
  },
  {
    title: "Annotation",
    value: "annotation",
    icon: StickyNote,
  },
  {
    title: "Just Exploring",
    value: "just_exploring",
    icon: Kayak,
  },
  {
    title: "Everything",
    value: "everything",
    icon: InfinityIcon,
  },
];

const roleItems: {
  title: string;
  value: Role;
  icon: typeof User;
}[] = [
  {
    title: "Product Manager",
    value: "product_manager",
    icon: Presentation,
  },
  {
    title: "Software Engineer",
    value: "software_engineer",
    icon: Code,
  },
  {
    title: "AI Engineer",
    value: "ai_engineer",
    icon: WandSparkles,
  },
  {
    title: "Engineering Manager",
    value: "engineering_manager",
    icon: PencilRuler,
  },
  {
    title: "Data Scientist",
    value: "data_scientist",
    icon: ChevronsLeftRightEllipsis
  },
  {
    title: "AI Researcher",
    value: "ai_researcher",
    icon: BrainCircuit,
  },
  {
    title: "CTO/Founder",
    value: "cto_founder",
    icon: ChefHat,
  },
  {
    title: "Other",
    value: "other",
    icon: BadgeQuestionMark,
  },
];

export const IntroPage: React.FC = () => {
  const { isLoading: organizationIsLoading } = useOrganizationTeamProject({
    redirectToProjectOnboarding: false,
  });

  const [usageStyle, setUsageStyle] = useState<UsageStyle | undefined>(void 0);
  const [companySize, setCompanySize] = useState<CompanySize | undefined>(
    void 0
  );
  const [solutionType, setSolutionType] = useState<SolutionType | undefined>(
    void 0
  );
  const [selectedDesires, setDesires] = useState<Desire[]>([]);
  const [role, setRole] = useState<Role | undefined>(void 0);

  return (
    <OrganizationOnboardingContainer loading={organizationIsLoading}>
      <VStack gap={4} align="stretch">
        <VStack gap={2} align="start">
          <Text textStyle={"2xl"} fontWeight={"bold"} color={"WindowText"}>
            {"Almost there..."}
          </Text>
          <Text textStyle={"md"} color={"WindowText"}>
            {"Help us get to know you better"}
          </Text>
        </VStack>

        <VStack gap={4} align="stretch">
          {/* Usage style */}
          <Field.Root colorPalette="orange" w="full" required>
            <Field.Label>
              {"How do you plan to use LangWatch?"}
              <Field.RequiredIndicator />
            </Field.Label>
            <RadioCard.Root
              size="sm"
              variant="outline"
              w="full"
              value={usageStyle}
              onValueChange={({ value }) => setUsageStyle(value as UsageStyle)}
            >
              <HStack align="stretch">
                {usageStyleItems.map((item) => (
                  <RadioCard.Item key={item.value} value={item.value}>
                    <RadioCard.ItemHiddenInput />
                    <RadioCard.ItemControl>
                      <RadioCard.ItemContent>
                        <HStack align="center" justify="space-between" w="full">
                          <HStack align="center" justify="center">
                            <Icon size="md" color="fg.muted">
                              <item.icon />
                            </Icon>
                            <RadioCard.ItemText>
                              {item.title}
                            </RadioCard.ItemText>
                          </HStack>
                          <RadioCard.ItemIndicator />
                        </HStack>
                      </RadioCard.ItemContent>
                    </RadioCard.ItemControl>
                  </RadioCard.Item>
                ))}
              </HStack>
            </RadioCard.Root>
          </Field.Root>

          {usageStyle !== void 0 && usageStyle !== "myself" && (
            <React.Fragment>
              {/* Phone number */}
              <Field.Root colorPalette="orange" w="full">
                <Field.Label>{"What is your phone number?"}</Field.Label>
                
              </Field.Root>

              {/* Company size */}
              <Field.Root colorPalette="orange" w="full">
                <Field.Label>{"How large is your company?"}</Field.Label>
                <SegmentGroup.Root
                  size="sm"
                  colorPalette="orange"
                  value={companySize}
                  onValueChange={({ value }) =>
                    setCompanySize(value as CompanySize)
                  }
                >
                  <SegmentGroup.Indicator />
                  <SegmentGroup.Items
                    items={companySizeItems.map((item) => ({
                      label: item.title,
                      value: item.value,
                    }))}
                  />
                </SegmentGroup.Root>
              </Field.Root>

              {/* Solution type */}
              <Field.Root colorPalette="orange" w="full">
                <Field.Label>
                  {"How do you plan to deploy LangWatch?"}
                </Field.Label>
                <RadioCard.Root
                  size="sm"
                  variant="outline"
                  w="full"
                  value={solutionType}
                  onValueChange={({ value }) =>
                    setSolutionType(value as SolutionType)
                  }
                >
                  <HStack align="stretch">
                    {solutionTypeItems.map((item) => (
                      <RadioCard.Item key={item.value} value={item.value}>
                        <RadioCard.ItemHiddenInput />
                        <RadioCard.ItemControl>
                          <RadioCard.ItemContent>
                            <HStack
                              align="center"
                              justify="space-between"
                              w="full"
                            >
                              <HStack align="center" justify="center">
                                <Icon size="md" color="fg.muted">
                                  <item.icon />
                                </Icon>
                                <RadioCard.ItemText>
                                  {item.title}
                                </RadioCard.ItemText>
                              </HStack>
                              <RadioCard.ItemIndicator />
                            </HStack>
                          </RadioCard.ItemContent>
                        </RadioCard.ItemControl>
                      </RadioCard.Item>
                    ))}
                  </HStack>
                </RadioCard.Root>
              </Field.Root>

              {/* Features (multi-select) */}
              <Field.Root colorPalette="orange" w="full">
                <Field.Label>
                  {"How do you plan to deploy LangWatch?"}
                </Field.Label>
                <CheckboxGroup
                  colorPalette="orange"
                  size="xs"
                  variant="outline"
                  w="full"
                  value={selectedDesires}
                  onValueChange={(value) => setDesires(value as Desire[])}
                >
                  <VStack gap="2" w="full">
                    {desireItems.map((item) => (
                      <CheckboxCard.Root
                        key={item.value}
                        value={item.value}
                        size="sm"
                        w="full"
                      >
                        <CheckboxCard.HiddenInput />
                        <CheckboxCard.Control>
                          <HStack
                            align="center"
                            justify="space-between"
                            w="full"
                          >
                            <CheckboxCard.Content>
                              <HStack>
                                <Icon size="md" color="fg.muted">
                                  <item.icon />
                                </Icon>
                                <CheckboxCard.Label>
                                  {item.title}
                                </CheckboxCard.Label>
                              </HStack>
                            </CheckboxCard.Content>
                            <CheckboxCard.Indicator />
                          </HStack>
                        </CheckboxCard.Control>
                      </CheckboxCard.Root>
                    ))}
                  </VStack>
                </CheckboxGroup>
              </Field.Root>

              {/* Role selection */}
              <Field.Root colorPalette="orange" w="full" required>
                <Field.Label>
                  {"What best describes you?"}
                  <Field.RequiredIndicator />
                </Field.Label>
                <RadioCard.Root
                  size="sm"
                  variant="outline"
                  w="full"
                  value={role}
                  onValueChange={({ value }) => setRole(value as Role)}
                >
                  <VStack align="stretch">
                    {roleItems.map((item) => (
                      <RadioCard.Item key={item.value} value={item.value}>
                        <RadioCard.ItemHiddenInput />
                        <RadioCard.ItemControl>
                          <RadioCard.ItemContent>
                            <HStack align="center" justify="space-between" w="full">
                              <HStack align="center" justify="center">
                                <Icon size="md" color="fg.muted">
                                  <item.icon />
                                </Icon>
                                <RadioCard.ItemText>
                                  {item.title}
                                </RadioCard.ItemText>
                              </HStack>
                              <RadioCard.ItemIndicator />
                            </HStack>
                          </RadioCard.ItemContent>
                        </RadioCard.ItemControl>
                      </RadioCard.Item>
                    ))}
                  </VStack>
                </RadioCard.Root>
              </Field.Root>
            </React.Fragment>
          )}

          <Button colorPalette="orange" variant="solid" w="fit-content">
            {"Next"}
          </Button>
        </VStack>
      </VStack>
    </OrganizationOnboardingContainer>
  );
};
