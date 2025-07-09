import {
  Button,
  Field,
  Heading,
  HStack,
  Textarea,
  VStack,
} from "@chakra-ui/react";
import { useCallback, useEffect, useMemo } from "react";
import { Play } from "react-feather";
import { useForm, type FieldError } from "react-hook-form";
import { HorizontalFormControl } from "../HorizontalFormControl";

// Create a simplified field type that matches what we need
export type InputField = {
  identifier: string;
  type: string;
  optional?: boolean;
  value?: unknown;
};

export type ExecuteData = Record<string, string>;

type InputPanelProps = {
  fields: InputField[];
  onExecute: (inputs: ExecuteData) => void;
  title?: string;
  buttonText?: string;
};

export const ExecutionInputPanel = ({
  fields = [],
  onExecute,
  title = "Inputs",
  buttonText = "Execute",
}: InputPanelProps) => {
  const defaultValues = useMemo(() => {
    return Object.fromEntries(
      fields.map((field) => [
        field.identifier,
        typeof field.value === "object"
          ? JSON.stringify(field.value)
          : field.value ?? "",
      ])
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(fields)]);

  const form = useForm<Record<string, string>>({
    defaultValues: defaultValues as Record<string, string>,
    resolver: (values) => {
      const response: {
        values: Record<string, string>;
        errors: Record<string, FieldError>;
      } = {
        values,
        errors: {},
      };

      // Find required fields that are missing
      const missingFields = fields
        .filter((field) => !field.optional)
        .filter(
          (field) =>
            !values[field.identifier] || values[field.identifier] === ""
        );

      for (const field of missingFields) {
        response.errors[field.identifier] = {
          type: "required",
          message: "This field is required",
        };
      }

      return response;
    },
  });

  const formValues = form.watch();

  useEffect(() => {
    if (JSON.stringify(formValues) !== JSON.stringify(defaultValues)) {
      form.reset(defaultValues as Record<string, string>);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultValues]);

  const onSubmit = useCallback(
    (data: Record<string, string>) => {
      onExecute(data);
    },
    [onExecute]
  );

  return (
    // eslint-disable-next-line @typescript-eslint/no-misused-promises
    <form onSubmit={form.handleSubmit(onSubmit)}>
      <VStack align="start" gap={3} width="full">
        <Heading
          as="h3"
          fontSize="16px"
          fontWeight="bold"
          textTransform="uppercase"
          color="gray.600"
          paddingBottom={4}
        >
          {title}
        </Heading>
        {fields.map((input) => {
          if (!input.identifier) return null;

          // Handle different input types better than this
          return (
            <HorizontalFormControl
              key={input.identifier}
              label={input.identifier}
              helper={""}
              invalid={!!form.formState.errors[input.identifier]}
            >
              <Textarea
                {...form.register(input.identifier)}
                placeholder={
                  input.type === "image"
                    ? "image url"
                    : input.type === "str"
                    ? undefined
                    : input.type
                }
              />
              <Field.ErrorText>
                {form.formState.errors[input.identifier]?.message}
              </Field.ErrorText>
            </HorizontalFormControl>
          );
        })}
        <HStack width="full" justify="end">
          <Button
            type="submit"
            colorPalette="green"
            loading={form.formState.isSubmitting}
            loadingText={buttonText}
          >
            {buttonText} <Play size={16} />
          </Button>
        </HStack>
      </VStack>
    </form>
  );
};
