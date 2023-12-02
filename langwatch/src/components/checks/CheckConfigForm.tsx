import {
  VStack,
  Button,
  Input,
  Select,
  Text,
  Card,
  CardBody,
  HStack,
  Spacer,
} from "@chakra-ui/react";
import DynamicZodForm from "./DynamicZodForm";
import { checksSchema } from "../../trace_checks/types.generated";
import { CustomRuleField } from "./CustomRuleField";
import { FormProvider, useFieldArray, useForm } from "react-hook-form";
import slugify from "slugify";
import { SettingsFormControl } from "../SettingsLayout";
import { useEffect } from "react";
import { customCheckRulesSchema } from "../../trace_checks/types.generated";
import type { CheckTypes, Checks } from "../../trace_checks/types";

const defaultParametersMap: Record<
  CheckTypes,
  Checks[CheckTypes]["parameters"]
> = {
  pii_check: {
    infoTypes: {
      phoneNumber: true,
      emailAddress: true,
      creditCardNumber: true,
      ibanCode: true,
      ipAddress: true,
      passport: true,
      vatNumber: true,
      medicalRecordNumber: true,
    },
    minLikelihood: "POSSIBLE",
  },
  custom: {
    rules: [
      {
        field: "output",
        rule: "not_contains",
        value: "",
        //@ts-ignore
        failWhen: { condition: "<", amount: 0.7 },
      },
    ],
  },
  toxicity_check: {},
};

export interface CheckConfigFormData {
  name: string;
  checkType: CheckTypes;
  parameters: Checks[CheckTypes]["parameters"];
}

interface CheckConfigFormProps {
  defaultValues?: Partial<CheckConfigFormData>;
  onSubmit: (data: CheckConfigFormData) => Promise<void>;
  isLoading: boolean;
}

export default function CheckConfigForm({
  defaultValues,
  onSubmit,
  isLoading,
}: CheckConfigFormProps) {
  const form = useForm<CheckConfigFormData>({
    defaultValues,
    // resolver: zodResolver(customCheckRulesSchema),
  });

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = form;

  const checkType = watch("checkType");

  useEffect(() => {
    const defaultValues = defaultParametersMap[checkType];

    const setDefaultValues = (
      defaultValues: Record<string, any>,
      prefix: string
    ) => {
      if (!defaultValues) return;

      Object.entries(defaultValues).forEach(([key, value]) => {
        if (
          typeof value === "object" &&
          !Array.isArray(value) &&
          value !== null
        ) {
          setDefaultValues(value, `${prefix}.${key}`);
        } else {
          //@ts-ignore
          form.setValue(`${prefix}.${key}`, value);
        }
      });
    };

    setDefaultValues(defaultValues, "parameters");
  }, [checkType, form]);

  const nameValue = watch("name");

  return (
    <FormProvider {...form}>
      {/* eslint-disable-next-line @typescript-eslint/no-misused-promises */}
      <form onSubmit={handleSubmit(onSubmit)} style={{ width: "100%" }}>
        <VStack spacing={6} align="start" width="full">
          <Card width="full">
            <CardBody>
              <VStack spacing={4}>
                <SettingsFormControl
                  label="Check Type"
                  helper="Select the type of check"
                  isInvalid={!!errors.checkType}
                >
                  <Select
                    id="checkType"
                    {...register("checkType", { required: true })}
                  >
                    <option value="custom">Custom</option>
                    <option value="pii_check">PII Check</option>
                    <option value="toxicity_check">Toxicity Check</option>
                  </Select>
                </SettingsFormControl>
                <SettingsFormControl
                  label="Name"
                  helper="Used to identify the check and call it from the API"
                  isInvalid={!!errors.name}
                  align="start"
                >
                  <VStack spacing={2} align="start">
                    <Input
                      id="name"
                      {...register("name", { required: true })}
                    />
                    <Text fontSize={12} paddingLeft={4}>
                      {nameValue && "slug: "}
                      {slugify(nameValue || "", { lower: true, strict: true })}
                    </Text>
                  </VStack>
                </SettingsFormControl>
                {checkType === "custom" && <CustomRuleField />}
                {checkType &&
                  checkType !== "custom" &&
                  checksSchema.shape[checkType] && (
                    <DynamicZodForm
                      schema={checksSchema.shape[checkType].shape.parameters}
                      checkType={checkType}
                      prefix="parameters"
                    />
                  )}
              </VStack>
            </CardBody>
          </Card>
          <HStack width="full">
            <Spacer />
            <Button
              colorScheme="orange"
              type="submit"
              minWidth="92px"
              isLoading={isLoading}
            >
              Save
            </Button>
          </HStack>
        </VStack>
      </form>
    </FormProvider>
  );
}
