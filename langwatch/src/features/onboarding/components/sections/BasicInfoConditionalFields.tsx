import { Field, NativeSelect, VStack } from "@chakra-ui/react";
import { useCollapse } from "react-collapsed";
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

  const { getCollapseProps } = useCollapse({ isExpanded: showFields });

  return (
    <div {...getCollapseProps()} style={{ ...getCollapseProps().style, width: "100%" }}>
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
          <NativeSelect.Root
            size="sm"
            colorPalette="orange"
          >
            <NativeSelect.Field
              placeholder="Select company size"
              value={companySize}
              onChange={(e) => {
                setCompanySize(e.target.value as CompanySize);
                emit("selected", "company_size", {
                  value: e.target.value,
                });
              }}
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
    </div>
  );
};
