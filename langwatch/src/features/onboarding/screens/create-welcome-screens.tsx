import React, { useMemo } from "react";
import {
  VStack,
  Field,
  Input,
  Icon,
  /* eslint-disable no-restricted-imports */
  Checkbox,
  /* eslint-enable no-restricted-imports */
} from "@chakra-ui/react";
import { useAnalytics } from "react-contextual-analytics";
import { ExternalLink } from "lucide-react";
import { IconRadioCardGroup } from "../../../components/forms/IconRadioCardGroup";
import { IconCheckboxCardGroup } from "../../../components/forms/IconCheckboxCardGroup";
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
  type DesireType,
  type RoleType,
  OnboardingScreenIndex,
  type OnboardingFlowConfig,
} from "../types/types";
import { BasicInfoConditionalFields } from "../components/sections/BasicInfoConditionalFields";
import { Link } from "~/components/ui/link";

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
    setDesires: (value: DesireType[]) => void;
    setRole: (value: RoleType | undefined) => void;
  };
}

export const useCreateWelcomeScreens = ({
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

  const OrganizationScreen: React.FC = () => {
    const { emit } = useAnalytics();

    return (
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
            onCheckedChange={(details) => {
              const checked = details.checked === true;

              setAgreement(checked);
              emit("toggled", "terms_agreement", { checked });
            }}
          >
            <Checkbox.HiddenInput />
            <Checkbox.Control>
              <Checkbox.Indicator />
            </Checkbox.Control>
            <Checkbox.Label fontWeight={"normal"}>
              {"I agree to the LangWatch "}
              <Link
                href="https://langwatch.ai/legal/terms-conditions"
                isExternal
                fontWeight={"bold"}
                variant={"underline"}
              >
                {"Terms of Service"}
                <Icon size="xs">
                  <ExternalLink />
                </Icon>
              </Link>
            </Checkbox.Label>
          </Checkbox.Root>
        </Field.Root>
      </VStack>
    );
  };

  const BasicInfoScreen: React.FC = () => {
    const { emit } = useAnalytics();
    return (
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
            onChange={(value) => {
              setUsageStyle(value);
              emit("selected", "usage_style", { value });
            }}
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
    );
  };

  const DesiresScreen: React.FC = () => {
    const { emit } = useAnalytics();
    return (
      <IconCheckboxCardGroup<DesireType>
        label={"What brings you to LangWatch?"}
        items={desireItems}
        value={selectedDesires}
        onChange={(values) => {
          setDesires(values);
          emit("selected", "desires", { values, count: values.length });
        }}
      />
    );
  };

  const RoleScreen: React.FC = () => {
    const { emit } = useAnalytics();
    return (
      <Field.Root colorPalette="orange" w="full">
        <Field.Label>{"What best describes you?"}</Field.Label>
        <IconRadioCardGroup<RoleType>
          items={roleItems}
          value={role}
          onChange={(value) => {
            setRole(value);
            emit("selected", "role", { value });
          }}
          direction="vertical"
        />
      </Field.Root>
    );
  };

  const screens: Record<OnboardingScreenIndex, OnboardingScreen> = useMemo(
    () => ({
      [OnboardingScreenIndex.ORGANIZATION]: {
        id: "organization",
        required: true,
        heading: "Welcome Aboard 👋",
        subHeading: "Let's kick off by creating your organization",
        component: <OrganizationScreen />,
      },
      [OnboardingScreenIndex.BASIC_INFO]: {
        id: "basic-info",
        required: true,
        heading: "Let's tailor your experience",
        component: <BasicInfoScreen />,
      },
      [OnboardingScreenIndex.DESIRES]: {
        id: "desires",
        required: false,
        heading: "Let's tailor your experience",
        component: <DesiresScreen />,
      },
      [OnboardingScreenIndex.ROLE]: {
        id: "role",
        required: false,
        heading: "Let's tailor your experience",
        component: <RoleScreen />,
      },
    }),
    // Only recreate JSX when these values change
    [organizationName, agreement, usageStyle, companySize, solutionType, selectedDesires, role],
  );

  return flow.visibleScreens.map((idx) => screens[idx]);
};
