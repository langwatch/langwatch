import { useEffect } from "react";
import { VStack, Textarea } from "@chakra-ui/react";
import { useForm } from "react-hook-form";
import type { z } from "zod";
import { type runtimeInputsSchema } from "~/prompt-configs/schemas/field-schemas";

type RuntimeInput = z.infer<typeof runtimeInputsSchema>[number];

export type VariablesFormProps = {
  inputs: RuntimeInput[];
  onChange: (values: Record<string, unknown>) => void;
};

export function VariablesForm({ inputs, onChange }: VariablesFormProps) {
  // Convert array of inputs to a values object (by identifier)
  const defaultValues = Object.fromEntries(
    (inputs || []).map((field) => [
      field.identifier,
      typeof field.value === "object" && field.value !== null
        ? JSON.stringify(field.value)
        : field.value ?? "",
    ]),
  );

  const form = useForm<Record<string, string>>({
    defaultValues,
  });

  // Watch form state and call onChange when it updates
  const values = form.watch();
  useEffect(() => {
    onChange(values);
    // We intentionally want this to run whenever form values change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values]);

  return (
    <VStack align="start" gap={3} width="full">
      {(inputs || []).map((input) => {
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
              {...form.register(input.identifier)}
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
