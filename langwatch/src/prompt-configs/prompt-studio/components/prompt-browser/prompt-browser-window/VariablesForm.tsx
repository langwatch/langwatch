import { zodResolver } from "@hookform/resolvers/zod";
import { VStack, Textarea } from "@chakra-ui/react";
import { useForm } from "react-hook-form";
import { useMemo } from "react";
import type { z } from "zod";
import { runtimeInputsSchema } from "~/prompt-configs/schemas/field-schemas";

type RuntimeInput = z.infer<typeof runtimeInputsSchema>[number];

export type VariablesFormProps = {
  inputs: RuntimeInput[];
  onChange: (values: z.infer<typeof runtimeInputsSchema>) => void;
};

export function VariablesForm({ inputs, onChange }: VariablesFormProps) {
  const defaultValues = useMemo(() => {
    return inputs.map((input) => ({
      ...input,
      value: input.value ?? "",
    }));
  }, [inputs]);

  const form = useForm<z.infer<typeof runtimeInputsSchema>>({
    defaultValues,
    resolver: zodResolver(runtimeInputsSchema),
  });

  // Watch form state and call onChange when it updates
  form.watch((values) => onChange(values));

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
