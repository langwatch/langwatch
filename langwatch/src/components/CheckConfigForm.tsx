import {
  VStack,
  Button,
  FormControl,
  FormLabel,
  Input,
  Select,
  Text,
} from "@chakra-ui/react";
import { useForm, useFormState } from "react-hook-form";
import slugify from "slugify";

export interface CheckConfigFormData {
  name: string;
  checkType: "pii_check" | "toxicity_check" | "custom";
}

interface CheckConfigFormProps {
  defaultValues?: CheckConfigFormData;
  onSubmit: (data: CheckConfigFormData) => Promise<void>;
}

export default function CheckConfigForm({
  defaultValues,
  onSubmit,
}: CheckConfigFormProps) {
  const { register, handleSubmit, control, watch } =
    useForm<CheckConfigFormData>({ defaultValues });
  const { errors } = useFormState({ control });
  const nameValue = watch("name");

  return (
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    <form onSubmit={handleSubmit(onSubmit)}>
      <VStack spacing={4}>
        <FormControl isInvalid={!!errors.name}>
          <FormLabel htmlFor="name">Name</FormLabel>
          <Input id="name" {...register("name", { required: true })} />
        </FormControl>
        <FormControl isInvalid={!!errors.checkType}>
          <FormLabel htmlFor="checkType">Check Type</FormLabel>
          <Select id="checkType" {...register("checkType", { required: true })}>
            <option value="pii_check">PII Check</option>
            <option value="toxicity_check">Toxicity Check</option>
            <option value="custom">Custom</option>
          </Select>
        </FormControl>
        <FormControl>
          <FormLabel>Slug Preview</FormLabel>
          <Text>{slugify(nameValue || "", { lower: true, strict: true })}</Text>
        </FormControl>
        <Button type="submit">Submit</Button>
      </VStack>
    </form>
  );
}
