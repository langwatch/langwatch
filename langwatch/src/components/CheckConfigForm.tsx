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
import { useForm, useFormState } from "react-hook-form";
import slugify from "slugify";
import { SettingsFormControl } from "./SettingsLayout";

export interface CheckConfigFormData {
  name: string;
  checkType: "pii_check" | "toxicity_check" | "custom";
}

interface CheckConfigFormProps {
  defaultValues?: CheckConfigFormData;
  onSubmit: (data: CheckConfigFormData) => Promise<void>;
  isLoading: boolean;
}

export default function CheckConfigForm({
  defaultValues,
  onSubmit,
  isLoading,
}: CheckConfigFormProps) {
  const { register, handleSubmit, control, watch } =
    useForm<CheckConfigFormData>({ defaultValues });
  const { errors } = useFormState({ control });
  const nameValue = watch("name");

  return (
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
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
                  <Input id="name" {...register("name", { required: true })} />
                  <Text fontSize={12} paddingLeft={4}>
                    {nameValue && "slug: "}
                    {slugify(nameValue || "", { lower: true, strict: true })}
                  </Text>
                </VStack>
              </SettingsFormControl>
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
  );
}
