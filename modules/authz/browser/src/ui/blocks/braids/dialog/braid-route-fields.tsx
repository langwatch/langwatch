// From and Into: the project the braid starts from is fixed; the picker offers the projects the
// viewer can read, the braid's own project and aggregates disabled with the reason.

import { Menu } from "@langwatch/design-system/menu";
import { Button, Field, HStack, Stack, Text } from "@langwatch/design-system/primitives";
import { ArrowRight, Check, ChevronDown, Lock } from "lucide-react";

import type { BraidTargetOption } from "../../../../model/braids/braid-draft.ts";
import type { BraidProject } from "../../../../model/braids/braids.ts";
import { BraidProjectBadge } from "../../../elements/braid-project.tsx";

export type BraidRouteFieldsProps = {
  owner: BraidProject;
  reader: BraidProject | undefined;
  options: readonly BraidTargetOption[];
  someLeftOut: boolean;
  isLoading: boolean;
  /** Edit keeps the reader: a braid into another project is a new braid. */
  readerFixed: boolean;
  onPick: (projectId: string) => void;
};

function OptionEnd({ option, picked }: { option: BraidTargetOption; picked: boolean }) {
  if (option.reason) {
    return (
      <Text fontSize="xs" color="fg.subtle">
        {option.reason}
      </Text>
    );
  }
  return picked ? <Check size={14} aria-label="Picked" /> : null;
}

export function BraidRouteFields(props: BraidRouteFieldsProps) {
  return (
    <Stack gap={2}>
      <HStack gap={3} align="end">
        <Field.Root flex={1}>
          <Field.Label>From</Field.Label>
          <HStack
            gap={2}
            width="full"
            paddingX={3}
            height="36px"
            borderWidth="1px"
            borderRadius="md"
            bg="bg.subtle"
            data-testid="braid-from"
          >
            <BraidProjectBadge project={props.owner} size="sm" />
            <Text flex={1} truncate>
              {props.owner.name}
            </Text>
            <Lock size={12} aria-label="Fixed" />
          </HStack>
          <Field.HelperText>Owns the spans</Field.HelperText>
        </Field.Root>
        <Stack paddingBottom={7} color="fg.subtle">
          <ArrowRight size={16} aria-hidden />
        </Stack>
        <Field.Root flex={1}>
          <Field.Label>Into</Field.Label>
          <Menu.Root>
            <Menu.Trigger asChild>
              <Button
                variant="outline"
                width="full"
                justifyContent="space-between"
                disabled={props.readerFixed || props.isLoading}
                data-testid="braid-into"
              >
                <HStack gap={2} minWidth={0}>
                  {props.reader ? <BraidProjectBadge project={props.reader} size="sm" /> : null}
                  <Text truncate>
                    {props.reader?.name ??
                      (props.isLoading ? "Loading projects" : "Pick a project")}
                  </Text>
                </HStack>
                {props.readerFixed ? (
                  <Lock size={12} aria-hidden />
                ) : (
                  <ChevronDown size={14} aria-hidden />
                )}
              </Button>
            </Menu.Trigger>
            <Menu.Content minWidth="280px">
              {props.options.map((option) => (
                <Menu.Item
                  key={option.projectId}
                  value={option.projectId}
                  disabled={!option.selectable}
                  onClick={() => props.onPick(option.projectId)}
                  data-testid="braid-target"
                >
                  <HStack justify="space-between" width="full" gap={4}>
                    <Text>{option.name}</Text>
                    <OptionEnd option={option} picked={option.projectId === props.reader?.id} />
                  </HStack>
                </Menu.Item>
              ))}
            </Menu.Content>
          </Menu.Root>
          <Field.HelperText>Sees them in its traces</Field.HelperText>
        </Field.Root>
      </HStack>
      {props.someLeftOut ? (
        <Text fontSize="xs" color="fg.muted" data-testid="braid-targets-note">
          A braid can only go into a project whose traces you can read.
        </Text>
      ) : null}
    </Stack>
  );
}
