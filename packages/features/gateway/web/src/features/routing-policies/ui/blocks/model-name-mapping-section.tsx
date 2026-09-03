import { Button, HStack, IconButton, Input, Text, VStack } from "@chakra-ui/react";
import { ArrowRight, Plus, Trash2 } from "lucide-react";
import { type Control, type UseFormRegister, useFieldArray } from "react-hook-form";

import { FieldInfoTooltip } from "@langwatch/design-system/field-info-tooltip";

import type { RoutingPolicyFormValues } from "../../model/routing-policy-form";

/**
 * Free-form model name mapping: everything that is not one of the reserved
 * tiers. The gateway treats both the same way, but they are different
 * decisions, so they are edited apart.
 */
export function ModelNameMappingSection({
  control,
  register,
}: {
  control: Control<RoutingPolicyFormValues>;
  register: UseFormRegister<RoutingPolicyFormValues>;
}) {
  const { fields, append, remove } = useFieldArray({
    control,
    name: "nameMappings",
  });

  return (
    <VStack align="stretch" gap={2}>
      <HStack>
        <Text fontSize="sm" fontWeight="semibold">
          Model name mapping
        </Text>
        <FieldInfoTooltip
          description="Rewrites the model name a client asks for before the request reaches a provider. Use it to send an old name to its replacement, or to give a model a name your teams already use."
          docHref="/ai-gateway/model-aliases"
        />
      </HStack>
      <Text fontSize="xs" color="fg.muted">
        The model a mapping points at is checked against everything this policy allows, so
        a mapping can never reach a model the key may not use.
      </Text>

      {fields.length === 0 && (
        <Text fontSize="xs" color="fg.muted">
          No mappings yet. Clients ask for models by their own names.
        </Text>
      )}

      {fields.map((field, index) => (
        <HStack key={field.id} gap={2}>
          <Input
            size="sm"
            placeholder="Name the client sends"
            aria-label={`Requested model name ${index + 1}`}
            {...register(`nameMappings.${index}.from`)}
          />
          <ArrowRight size={14} />
          <Input
            size="sm"
            placeholder="Model to use instead"
            aria-label={`Model served for mapping ${index + 1}`}
            {...register(`nameMappings.${index}.to`)}
          />
          <IconButton
            aria-label={`Remove mapping ${index + 1}`}
            variant="ghost"
            size="xs"
            onClick={() => remove(index)}
          >
            <Trash2 size={12} />
          </IconButton>
        </HStack>
      ))}

      <Button
        size="xs"
        variant="outline"
        alignSelf="start"
        onClick={() => append({ from: "", to: "" })}
      >
        <Plus size={12} /> Add mapping
      </Button>
    </VStack>
  );
}
