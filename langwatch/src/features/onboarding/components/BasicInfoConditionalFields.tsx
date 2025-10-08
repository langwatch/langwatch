import { VStack, Field, Input, SegmentGroup, NativeSelect } from "@chakra-ui/react";
import { AnimatePresence, motion } from "motion/react";
import { useRef, useEffect } from "react";
import { companySizeItems, solutionTypeItems } from "../constants/onboarding-data";
import type { CompanySize, SolutionType, UsageStyle } from "../types/types";
import { IconRadioCardGroup } from "./IconRadioCardGroup";

interface BasicInfoConditionalFieldsProps {
  usageStyle: UsageStyle | undefined;
  phoneNumber: string | undefined;
  setPhoneNumber: (value: string) => void;
  companySize: CompanySize | undefined;
  setCompanySize: (value: CompanySize) => void;
  solutionType: SolutionType | undefined;
  setSolutionType: (value: SolutionType | undefined) => void;
}

export const BasicInfoConditionalFields: React.FC<BasicInfoConditionalFieldsProps> = ({
  usageStyle,
  phoneNumber,
  setPhoneNumber,
  companySize,
  setCompanySize,
  solutionType,
  setSolutionType,
}: {
  usageStyle: UsageStyle | undefined;
  phoneNumber: string | undefined;
  setPhoneNumber: (value: string) => void;
  companySize: CompanySize | undefined;
  setCompanySize: (value: CompanySize) => void;
  solutionType: SolutionType | undefined;
  setSolutionType: (value: SolutionType | undefined) => void;
}) => {
  const prevUsageStyle = useRef<UsageStyle | undefined>(usageStyle);
  const shouldAnimate = useRef(false);

  useEffect(() => {
    if (prevUsageStyle.current !== usageStyle) {
      shouldAnimate.current = true;
      prevUsageStyle.current = usageStyle;
    }
  }, [usageStyle]);

  const showFields = usageStyle !== void 0 && usageStyle !== "myself";

  return (
    <AnimatePresence mode="wait">
      {showFields && (
        <motion.div
          layout
          layoutId="conditional-fields"
          initial={shouldAnimate.current ? { opacity: 0, height: 0 } : false}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={{
            duration: 0.4,
            ease: "easeInOut",
            layout: { duration: 0.3 },
          }}
        >
          <VStack gap={4} align="stretch">
            {/* Phone number */}
            <motion.div
              initial={shouldAnimate.current ? { opacity: 0, y: -10 } : false}
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
              initial={shouldAnimate.current ? { opacity: 0, y: -10 } : false}
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
              initial={shouldAnimate.current ? { opacity: 0, y: -10 } : false}
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
  );
};
