import { Field, VStack } from "@chakra-ui/react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { useAnalytics } from "react-contextual-analytics";
import { IconRadioCardGroup } from "../../../../components/forms/IconRadioCardGroup";
import { PhoneNumberInput } from "../../../../components/inputs/PhoneNumberInput";
import {
  companySizeItems,
  solutionTypeItems,
} from "../../constants/onboarding-data";
import type { CompanySize, SolutionType, UsageStyle } from "../../types/types";

interface BasicInfoConditionalFieldsProps {
  usageStyle: UsageStyle | undefined;
  phoneNumber: string | undefined;
  setPhoneNumber: (value: string) => void;
  setPhoneHasValue: (value: boolean) => void;
  setPhoneIsValid: (value: boolean) => void;
  companySize: CompanySize | undefined;
  setCompanySize: (value: CompanySize) => void;
  solutionType: SolutionType | undefined;
  setSolutionType: (value: SolutionType | undefined) => void;
}

export const BasicInfoConditionalFields: React.FC<
  BasicInfoConditionalFieldsProps
> = ({
  usageStyle,
  phoneNumber,
  setPhoneNumber,
  setPhoneHasValue,
  setPhoneIsValid,
  companySize,
  setCompanySize,
  solutionType,
  setSolutionType,
}) => {
  const showFields = usageStyle !== void 0 && usageStyle !== "For myself";

  const [phoneHasValue, setLocalPhoneHasValue] = useState<boolean>(
    Boolean(phoneNumber),
  );
  const [phoneIsValid, setLocalPhoneIsValid] = useState<boolean>(true);
  const { emit } = useAnalytics({ usageStyle });

  return (
    <AnimatePresence>
      {showFields && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.3, ease: "easeInOut" }}
          style={{ width: "100%", overflow: "hidden" }}
        >
      <VStack gap={6} align="stretch" pt={4} w="full" minW="0">
        <Field.Root
          colorPalette="orange"
          w="full"
          invalid={phoneHasValue && !phoneIsValid}
        >
          <Field.Label>{"What is your phone number?"}</Field.Label>
          <PhoneNumberInput
            autoDetectDefaultCountry
            value={phoneNumber}
            onFocus={() => emit("focused", "phone_number")}
            onChange={(e164, meta) => {
              setPhoneNumber(e164 ?? "");
              const hasValue = meta.national.trim().length > 0;
              setLocalPhoneHasValue(hasValue);
              setLocalPhoneIsValid(Boolean(meta.isValid));
              setPhoneHasValue(hasValue);
              setPhoneIsValid(Boolean(meta.isValid));
            }}
          />
        </Field.Root>

        <Field.Root colorPalette="orange" w="full">
          <Field.Label>{"How large is your company?"}</Field.Label>
          <IconRadioCardGroup<CompanySize>
            items={companySizeItems}
            value={companySize}
            onChange={(value) => {
              if (value) {
                setCompanySize(value);
                emit("selected", "company_size", { value });
              }
            }}
            direction="horizontal"
            maxColumns={3}
          />
        </Field.Root>

        <Field.Root colorPalette="orange" w="full">
          <Field.Label>
            {"How do you plan to deploy LangWatch?"}
          </Field.Label>
          <IconRadioCardGroup<SolutionType>
            items={solutionTypeItems}
            value={solutionType}
            onChange={(value) => {
              setSolutionType(value);
              emit("selected", "solution_type", { value });
            }}
            direction="horizontal"
          />
        </Field.Root>
      </VStack>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
