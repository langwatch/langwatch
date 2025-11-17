import { zodResolver } from "@hookform/resolvers/zod";
import { VStack, Textarea } from "@chakra-ui/react";
import { useForm } from "react-hook-form";
import { useMemo, useEffect } from "react";
import type { z } from "zod";
import { runtimeInputsSchema } from "~/prompts/schemas/field-schemas";

type RuntimeInputFormValues = z.infer<typeof runtimeInputsSchema>;

export type VariablesFormProps = {
  inputs: RuntimeInputFormValues;
  onChange: (values: RuntimeInputFormValues) => void;
};

/**
 * VariablesForm component
 * Single Responsibility: Renders a form for editing runtime input variables
 * @param props - Component props
 * @param props.inputs - Array of input field configurations
 * @param props.onChange - Callback invoked when form values change
 */
export function VariablesForm({ inputs, onChange }: VariablesFormProps) {
  const defaultValues = useMemo(() => {
    return inputs.map((input) => ({
      ...input,
      value: input.value ?? "",
    }));
  }, [inputs]);

  const form = useForm<RuntimeInputFormValues>({
    defaultValues,
    resolver: zodResolver(runtimeInputsSchema),
  });

  // Reset form when inputs/defaultValues change
  useEffect(() => {
    form.reset(defaultValues);
  }, [form, defaultValues]);

  // Watch form state and call onChange when it updates
  useEffect(() => {
    const subscription = form.watch((values) => {
      onChange(values as RuntimeInputFormValues);
    });
    return () => subscription.unsubscribe();
  }, [form, onChange]);

  return (
    <VStack align="start" gap={3} width="full">
      {(inputs || []).map((input, i) => {
        if (!input.identifier) return null;
        return (
          <div key={input.identifier} style={{ width: "100%" }}>
            <label
              style={{
                display: "block",
                fontWeight: 500,
                marginBottom: "2px",
              }}
              htmlFor={input.identifier}
            >
              {input.identifier}
            </label>
            <Textarea
              id={input.identifier}
              {...form.register(`${i}.value` as any)}
              placeholder={
                input.type === "image"
                  ? "image url"
                  : input.type === "str"
                  ? undefined
                  : input.type
              }
              size="sm"
            />
          </div>
        );
      })}
    </VStack>
  );
}
