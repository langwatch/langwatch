import React from "react";
import {
  VStack,
  Field,
  Input,
  Icon,
  /* eslint-disable no-restricted-imports */
  Checkbox,
  Link,
  /* eslint-enable no-restricted-imports */
} from "@chakra-ui/react";
import { ExternalLink } from "lucide-react";
import { IconRadioCardGroup } from "../components/IconRadioCardGroup";
import { IconCheckboxCardGroup } from "../components/IconCheckboxCardGroup";
import {
  usageStyleItems,
  desireItems,
  roleItems,
} from "../constants/onboarding-data";
import {
  type OnboardingFormData,
  type OnboardingScreen,
  type UsageStyle,
  type CompanySize,
  type SolutionType,
  type Desire,
  type Role,
  OnboardingScreenIndex,
  type OnboardingFlowConfig,
} from "../types/types";
import { BasicInfoConditionalFields } from "../components/BasicInfoConditionalFields";

interface IntroScreensProps {
  formData: OnboardingFormData;
  flow: OnboardingFlowConfig;
  handlers: {
    setOrganizationName: (value: string) => void;
    setAgreement: (value: boolean) => void;
    setUsageStyle: (value: UsageStyle | undefined) => void;
    setPhoneNumber: (value: string) => void;
    setPhoneHasValue: (value: boolean) => void;
    setPhoneIsValid: (value: boolean) => void;
    setCompanySize: (value: CompanySize) => void;
    setSolutionType: (value: SolutionType | undefined) => void;
    setDesires: (value: Desire[]) => void;
    setRole: (value: Role | undefined) => void;
  };
}

export const useCreateScreens = ({
  formData,
  flow,
  handlers,
}: IntroScreensProps): OnboardingScreen[] => {
  const {
    organizationName,
    agreement,
    usageStyle,
    phoneNumber,
    companySize,
    solutionType,
    selectedDesires,
    role,
  } = formData;

  const {
    setOrganizationName,
    setAgreement,
    setUsageStyle,
    setPhoneNumber,
    setPhoneHasValue,
    setPhoneIsValid,
    setCompanySize,
    setSolutionType,
    setDesires,
    setRole,
  } = handlers;

  const screens: Record<OnboardingScreenIndex, OnboardingScreen> = {
    [OnboardingScreenIndex.ORGANIZATION]: {
      id: "organization",
      required: true,
      heading: "Welcome Aboard 👋",
      subHeading: "Let's kick off by creating your organization",
      component: (
        <VStack gap={4} align="stretch">
          <Field.Root colorPalette="orange">
            <Input
              autoFocus
              variant="outline"
              placeholder={"Company Name"}
              value={organizationName}
              onChange={(e) => setOrganizationName(e.target.value)}
            />
            <Field.HelperText>
              {
                "If you're using LangWatch for yourself, you can use your own name."
              }
            </Field.HelperText>
            <Field.ErrorText />
          </Field.Root>

          <Field.Root colorPalette="orange">
            <Checkbox.Root
              size="md"
              variant="subtle"
              checked={agreement}
              onCheckedChange={(details) =>
                setAgreement(details.checked === true)
              }
            >
              <Checkbox.HiddenInput />
              <Checkbox.Control>
                <Checkbox.Indicator />
              </Checkbox.Control>
              <Checkbox.Label fontWeight={"normal"}>
                {"I agree to the LangWatch "}
                <Link href="https://langwatch.ai/legal/terms-conditions" fontWeight={"bold"} variant="underline">
                  {"Terms of Service"}
                  <Icon size="xs">
                    <ExternalLink />
                  </Icon>
                </Link>
              </Checkbox.Label>
            </Checkbox.Root>
          </Field.Root>
        </VStack>
      ),
    },
    [OnboardingScreenIndex.BASIC_INFO]: {
      id: "basic-info",
      required: true,
      heading: "Let's tailor your experience",
      component: (
        <VStack gap={4} align="stretch">
          {/* Usage style */}
          <Field.Root colorPalette="orange" w="full" required>
            <Field.Label>
              {"Who are you building AI applications for?"}
              <Field.RequiredIndicator />
            </Field.Label>
            <IconRadioCardGroup<UsageStyle>
              items={usageStyleItems}
              value={usageStyle}
              onChange={setUsageStyle}
              direction="horizontal"
            />
          </Field.Root>

          <BasicInfoConditionalFields
            usageStyle={usageStyle}
            phoneNumber={phoneNumber}
            setPhoneNumber={setPhoneNumber}
            setPhoneHasValue={setPhoneHasValue}
            setPhoneIsValid={setPhoneIsValid}
            companySize={companySize}
            setCompanySize={setCompanySize}
            solutionType={solutionType}
            setSolutionType={setSolutionType}
          />
        </VStack>
      ),
    },
    [OnboardingScreenIndex.DESIRES]: {
      id: "desires",
      required: false,
      heading: "Let's tailor your experience",
      component: (
        <IconCheckboxCardGroup<Desire>
          label={"What brings you to LangWatch?"}
          items={desireItems}
          value={selectedDesires}
          onChange={setDesires}
        />
      ),
    },
    [OnboardingScreenIndex.ROLE]: {
      id: "role",
      required: false,
      heading: "Let's tailor your experience",
      component: (
        <Field.Root colorPalette="orange" w="full">
          <Field.Label>
            {"What best describes you?"}
            <Field.RequiredIndicator />
          </Field.Label>
          <IconRadioCardGroup<Role>
            items={roleItems}
            value={role}
            onChange={setRole}
            direction="vertical"
          />
        </Field.Root>
      ),
    },
  };

  return flow.visibleScreens.map((idx) => screens[idx]);
};
