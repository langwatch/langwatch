import {
  Box,
  Button,
  Field,
  HStack,
  IconButton,
  Input,
  NativeSelect,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Checkbox } from "@langwatch/design-system/checkbox";
import { Radio, RadioGroup } from "@langwatch/design-system/radio";
import { Plus, X } from "lucide-react";
import type { ReactNode } from "react";

export type AnnotationScoreEditorProps = {
  formError: ReactNode;
  nameField: ReactNode;
  nameError?: ReactNode;
  descriptionField: ReactNode;
  descriptionError?: ReactNode;
  dataType: string;
  dataTypeError?: ReactNode;
  onDataTypeChange: (value: string) => void;
  options: string[];
  onOptionChange: (index: number, value: string) => void;
  onOptionRemove: (index: number) => void;
  onOptionAdd: () => void;
  defaultRadioOption: string;
  onDefaultRadioOptionChange: (value: string) => void;
  defaultCheckboxOptions: string[];
  onDefaultCheckboxOptionsChange: (value: string[]) => void;
  isSaving: boolean;
  submitLabel: string;
};

/**
 * Controlled score-metric fields. The API form, mutation and error mapping
 * stay in the app container; this view owns only score editor interaction.
 */
export function AnnotationScoreEditor({
  formError,
  nameField,
  nameError,
  descriptionField,
  descriptionError,
  dataType,
  dataTypeError,
  onDataTypeChange,
  options,
  onOptionChange,
  onOptionRemove,
  onOptionAdd,
  defaultRadioOption,
  onDefaultRadioOptionChange,
  defaultCheckboxOptions,
  onDefaultCheckboxOptionsChange,
  isSaving,
  submitLabel,
}: AnnotationScoreEditorProps) {
  const isOption = dataType === "OPTION";
  const isCheckbox = dataType === "CHECKBOX";

  return (
    <VStack gap={2} align="start">
      {formError}
      <EditorField
        label="Name"
        helper="Give it a name that makes it easy to identify this score metric"
        invalid={!!nameError}
      >
        {nameField}
        <Field.ErrorText>{nameError}</Field.ErrorText>
      </EditorField>
      <EditorField
        label="Description"
        helper="Provide a description of the score metric"
        invalid={!!descriptionError}
      >
        {descriptionField}
        <Field.ErrorText>{descriptionError}</Field.ErrorText>
      </EditorField>
      <EditorField
        label="Score Type"
        helper={
          isOption
            ? "Single selection from multiple options"
            : isCheckbox
              ? "Allow multiple selections with checkboxes"
              : "Select the score type for the score metric"
        }
        invalid={!!dataTypeError}
      >
        <HStack width="full">
          <VStack align="start" width="full" gap={0}>
            <NativeSelect.Root>
              <NativeSelect.Field
                value={dataType}
                onChange={(event) => onDataTypeChange(event.target.value)}
              >
                <option value="OPTION">Multiple choice</option>
                <option value="CHECKBOX">Checkboxes</option>
              </NativeSelect.Field>
              <NativeSelect.Indicator />
            </NativeSelect.Root>
          </VStack>
        </HStack>
        <Field.ErrorText>{dataTypeError}</Field.ErrorText>

        {isOption && (
          <OptionEditor
            options={options}
            defaultRadioOption={defaultRadioOption}
            onDefaultRadioOptionChange={onDefaultRadioOptionChange}
            onOptionChange={onOptionChange}
            onOptionRemove={onOptionRemove}
            onOptionAdd={onOptionAdd}
          />
        )}
        {isCheckbox && (
          <CheckboxOptionEditor
            options={options}
            defaultCheckboxOptions={defaultCheckboxOptions}
            onDefaultCheckboxOptionsChange={onDefaultCheckboxOptionsChange}
            onOptionChange={onOptionChange}
            onOptionRemove={onOptionRemove}
            onOptionAdd={onOptionAdd}
          />
        )}
      </EditorField>

      <HStack width="full">
        <Spacer />
        <Button colorPalette="orange" type="submit" minWidth="fit-content" loading={isSaving}>
          {submitLabel}
        </Button>
      </HStack>
    </VStack>
  );
}

function EditorField({
  label,
  helper,
  invalid,
  children,
}: {
  label: string;
  helper: string;
  invalid: boolean;
  children: ReactNode;
}) {
  return (
    <Field.Root paddingY={2} invalid={invalid} width="full">
      <VStack width="full" align="start" gap={2}>
        <VStack align="start" gap={1} width="full">
          <Field.Label margin={0}>{label}</Field.Label>
          <Field.HelperText margin={0} fontSize="13px">
            {helper}
          </Field.HelperText>
        </VStack>
        <Box width="full">{children}</Box>
      </VStack>
    </Field.Root>
  );
}

function OptionEditor({
  options,
  defaultRadioOption,
  onDefaultRadioOptionChange,
  onOptionChange,
  onOptionRemove,
  onOptionAdd,
}: Pick<
  AnnotationScoreEditorProps,
  | "options"
  | "defaultRadioOption"
  | "onDefaultRadioOptionChange"
  | "onOptionChange"
  | "onOptionRemove"
  | "onOptionAdd"
>) {
  return (
    <Field.Root mt={4}>
      <VStack align="start" width="full" gap={2}>
        <RadioGroup
          verticalAlign="start"
          width="full"
          defaultValue={defaultRadioOption}
          value={defaultRadioOption}
        >
          <VStack align="start" width="full" gap={2}>
            {options.map((option, index) => (
              <HStack key={index} gap={2} width="full">
                <Radio
                  value={option}
                  onChange={(event) => onDefaultRadioOptionChange(event.target.value)}
                  onClick={() => {
                    if (defaultRadioOption === option) {
                      setTimeout(() => onDefaultRadioOptionChange(""), 100);
                    }
                  }}
                />
                <Input
                  aria-label={`Option ${index + 1}`}
                  placeholder="value"
                  value={option}
                  onChange={(event) => {
                    if (defaultRadioOption === option) {
                      onDefaultRadioOptionChange("");
                    }
                    onOptionChange(index, event.target.value);
                  }}
                />
                <RemoveOptionButton
                  disabled={options.length === 1}
                  onClick={() => onOptionRemove(index)}
                />
              </HStack>
            ))}
          </VStack>
        </RadioGroup>

        <AddOptionButton onClick={onOptionAdd} />
        {defaultRadioOption !== "" && (
          <Field.HelperText>
            <HStack>
              <X size={16} cursor="pointer" onClick={() => onDefaultRadioOptionChange("")} />
              Default Option: <Text>{defaultRadioOption}</Text>
            </HStack>
          </Field.HelperText>
        )}
      </VStack>
    </Field.Root>
  );
}

function CheckboxOptionEditor({
  options,
  defaultCheckboxOptions,
  onDefaultCheckboxOptionsChange,
  onOptionChange,
  onOptionRemove,
  onOptionAdd,
}: Pick<
  AnnotationScoreEditorProps,
  | "options"
  | "defaultCheckboxOptions"
  | "onDefaultCheckboxOptionsChange"
  | "onOptionChange"
  | "onOptionRemove"
  | "onOptionAdd"
>) {
  return (
    <Field.Root mt={4}>
      <VStack align="start" width="full">
        {options.map((option, index) => (
          <HStack key={index} width="full">
            <Box
              onClick={() => {
                if (defaultCheckboxOptions.includes(option)) {
                  setTimeout(() => {
                    onDefaultCheckboxOptionsChange(
                      defaultCheckboxOptions.filter((value) => value !== option),
                    );
                  }, 100);
                  return;
                }
                if (option.trim() !== "") {
                  onDefaultCheckboxOptionsChange([...defaultCheckboxOptions, option]);
                }
              }}
            >
              <Checkbox
                value={option}
                checked={defaultCheckboxOptions.includes(option)}
                disabled={!option.trim()}
              />
            </Box>
            <Input
              aria-label={`Option ${index + 1}`}
              placeholder="value"
              value={option}
              onChange={(event) => onOptionChange(index, event.target.value)}
            />
            <RemoveOptionButton
              disabled={options.length === 1}
              onClick={() => onOptionRemove(index)}
            />
          </HStack>
        ))}
        <AddOptionButton onClick={onOptionAdd} />
        {defaultCheckboxOptions.length > 0 && (
          <Field.HelperText>
            <HStack>
              <X size={16} cursor="pointer" onClick={() => onDefaultCheckboxOptionsChange([])} />
              Default Options: <Text>{defaultCheckboxOptions.join(", ")}</Text>
            </HStack>
          </Field.HelperText>
        )}
      </VStack>
    </Field.Root>
  );
}

function AddOptionButton({ onClick }: { onClick: () => void }) {
  return (
    <Button onClick={onClick} size="sm" colorPalette="orange">
      <Plus />
      Add Option
    </Button>
  );
}

function RemoveOptionButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  return (
    <IconButton
      aria-label="Remove option"
      colorPalette="gray"
      onClick={onClick}
      disabled={disabled}
    >
      <X />
    </IconButton>
  );
}
