import React from "react";
import { motion, AnimatePresence} from "motion/react";
import { VStack, Field, Input, SegmentGroup, NativeSelect } from "@chakra-ui/react";
import { IconRadioCardGroup } from "../components/IconRadioCardGroup";
import { IconCheckboxCardGroup } from "../components/IconCheckboxCardGroup";
import {
  usageStyleItems,
  companySizeItems,
  solutionTypeItems,
  desireItems,
  roleItems,
} from "../constants/onboarding-data";
import type {
  OnboardingFormData,
  OnboardingScreen,
  UsageStyle,
  CompanySize,
  SolutionType,
  Desire,
  Role,
} from "../types/types";

interface IntroScreensProps {
  formData: OnboardingFormData;
  handlers: {
    setUsageStyle: (value: UsageStyle | undefined) => void;
    setPhoneNumber: (value: string) => void;
    setCompanySize: (value: CompanySize) => void;
    setSolutionType: (value: SolutionType | undefined) => void;
    setDesires: (value: Desire[]) => void;
    setRole: (value: Role | undefined) => void;
  };
}

export const createIntroScreens = ({
  formData,
  handlers,
}: IntroScreensProps): OnboardingScreen[] => {
  const {
    usageStyle,
    phoneNumber,
    companySize,
    solutionType,
    selectedDesires,
    role,
  } = formData;

  const {
    setUsageStyle,
    setPhoneNumber,
    setCompanySize,
    setSolutionType,
    setDesires,
    setRole,
  } = handlers;

  return [
    {
      id: "basic-info",
      required: true,
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

          <AnimatePresence mode="wait">
            {usageStyle !== void 0 && usageStyle !== "myself" && (
              <motion.div
                layout
                layoutId="conditional-fields"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{
                  duration: 0.4,
                  ease: "easeInOut",
                  layout: { duration: 0.3 },
                }}
                // style={{ overflow: "hidden" }}
              >
                <VStack gap={4} align="stretch">
                  {/* Phone number */}
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: 0.1 }}
                  >
                    <Field.Root colorPalette="orange" w="full">
                      <Field.Label>{"What is your phone number?"}</Field.Label>
                      <Input
                        size="sm"
                        colorPalette="orange"
                        value={phoneNumber}
                        onChange={(e) => setPhoneNumber(e.target.value)}
                      />
                    </Field.Root>
                  </motion.div>

                  {/* Company size */}
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: 0.2 }}
                  >
                    <Field.Root colorPalette="orange" w="full">
                      <Field.Label>{"How large is your company?"}</Field.Label>
                      <SegmentGroup.Root
                        size="sm"
                        colorPalette="orange"
                        value={companySize}
                        onValueChange={({ value }) =>
                          setCompanySize(value as CompanySize)
                        }
                        display={{ base: "none", md: "flex" }}
                      >
                        <SegmentGroup.Indicator />
                        <SegmentGroup.Items
                          items={companySizeItems.map((item) => ({
                            label: item.title,
                            value: item.value,
                          }))}
                        />
                      </SegmentGroup.Root>

                      <NativeSelect.Root
                        size="sm"
                        colorPalette="orange"
                        display={{ base: "flex", md: "none" }}
                      >
                        <NativeSelect.Field
                          placeholder="Select company size"
                          value={companySize}
                          onChange={(e) =>
                            setCompanySize(e.target.value as CompanySize)
                          }
                        >
                          {companySizeItems.map((item) => (
                            <option key={item.value} value={item.value}>
                              {item.title}
                            </option>
                          ))}
                        </NativeSelect.Field>
                        <NativeSelect.Indicator />
                      </NativeSelect.Root>
                    </Field.Root>
                  </motion.div>

                  {/* Solution type */}
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3, delay: 0.3 }}
                  >
                    <Field.Root colorPalette="orange" w="full">
                      <Field.Label>
                        {"How do you plan to deploy LangWatch?"}
                      </Field.Label>
                      <IconRadioCardGroup<SolutionType>
                        items={solutionTypeItems}
                        value={solutionType}
                        onChange={setSolutionType}
                        direction="horizontal"
                      />
                    </Field.Root>
                  </motion.div>
                </VStack>
              </motion.div>
            )}
          </AnimatePresence>
        </VStack>
      ),
    },
    {
      id: "desires",
      required: false,
      component: (
        <Field.Root colorPalette="orange" w="full">
          <Field.Label>{"What brings you to LangWatch?"}</Field.Label>
          <IconCheckboxCardGroup<Desire>
            items={desireItems}
            value={selectedDesires}
            onChange={setDesires}
          />
        </Field.Root>
      ),
    },
    {
      id: "role",
      required: false,
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
  ];
};
