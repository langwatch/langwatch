import { Button, Input, VStack, Text, HStack } from "@chakra-ui/react";
import { Edit2Icon, SaveIcon } from "lucide-react";
import { useForm } from "react-hook-form";
import { VerticalFormControl } from "~/components/VerticalFormControl";
import { VersionHistoryListPopover } from "../VersionHistoryListPopover";
import { EditableTextField } from "./fields/EditableTextField";

interface PromptFormProps {
  initialValues: any;
  onSubmit: (values: any) => void;
}

/**
 * Prompt Form
 *
 * For changing the prompt name, restoring a version, and saving configurations.
 */
export function PromptForm({ initialValues, onSubmit }: PromptFormProps) {
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    defaultValues: initialValues,
  });

  const handleSave = (values: any) => {
    console.log(values);
    onSubmit(values);
  };

  return (
    <form onSubmit={() => handleSubmit(handleSave)}>
      <VStack gap={4} align="stretch">
        <EditableTextField
          {...register("promptName")}
          label={
            <HStack gap={2}>
              <Text>Prompt Name</Text>
              <Edit2Icon size={16} />
            </HStack>
          }
          placeholder="Enter a name for this prompt"
        />

        <HStack gap={4} align="stretch">
          <VerticalFormControl
            label="Description"
            cursor="pointer"
            borderBottomWidth={0}
          >
            <Input
              id="commitMessage"
              placeholder="Enter a description for this version"
              {...register("commitMessage")}
            />
          </VerticalFormControl>
          <VStack marginTop={4} marginBottom={6} justify="space-between">
            <HStack>
              <Text>Version</Text>
              <VersionHistoryListPopover />
            </HStack>
            <Button type="button" colorScheme="gray" aria-label="Save">
              <SaveIcon />
              Save
            </Button>
          </VStack>
        </HStack>
      </VStack>
    </form>
  );
}
