// From and Into: the project the braid starts from is fixed, so it reads as plain text; the picker
// offers the projects the viewer can read, the braid's own project and aggregates disabled.

import { Banner, BannerAction } from "@langwatch/design-system/banner";
import {
  createListCollection,
  Field,
  HStack,
  Stack,
  Text,
} from "@langwatch/design-system/primitives";
import { ProjectAvatar } from "@langwatch/design-system/project-avatar";
import { Select } from "@langwatch/design-system/select";
import { ArrowRight } from "lucide-react";
import type { Ref } from "react";

import { type BraidTargetOption, braidTargetLabel } from "../../../../model/braids/braid-draft.ts";
import type { BraidProject } from "../../../../model/braids/braids.ts";

export type BraidRouteFieldsProps = {
  owner: BraidProject;
  reader: BraidProject | undefined;
  options: readonly BraidTargetOption[];
  someLeftOut: boolean;
  /** Set when the organisation has more projects than the picker asks about: how many it lists. */
  listedOnly?: number;
  isLoading: boolean;
  /** The target list query failed: the picker would be empty for the wrong reason. */
  loadFailed: boolean;
  onRetry: () => void;
  /** Edit keeps the reader: a braid into another project is a new braid. */
  readerFixed: boolean;
  onPick: (projectId: string) => void;
  /** The picker's trigger, so the dialog can open with focus on it rather than on From. */
  intoRef?: Ref<HTMLButtonElement>;
};

/** The arrow between From and Into, under a hidden label so it centres on the controls. */
function RouteArrow() {
  return (
    <Field.Root width="auto" aria-hidden>
      <Field.Label visibility="hidden">To</Field.Label>
      <HStack height="10" color="fg.muted">
        <ArrowRight size={16} />
      </HStack>
    </Field.Root>
  );
}

/** The loaded options, plus the braid's reader when the list did not load it (edit keeps it). */
function pickerOptions({ options, reader }: BraidRouteFieldsProps): readonly BraidTargetOption[] {
  if (!reader || options.some((option) => option.projectId === reader.id)) return options;
  return [...options, { projectId: reader.id, name: reader.name, selectable: false }];
}

function IntoPicker(props: BraidRouteFieldsProps) {
  const collection = createListCollection({
    items: pickerOptions(props).map((option) => ({
      value: option.projectId,
      label: option.name,
      disabled: !option.selectable,
      option,
    })),
  });
  const placeholder = props.isLoading ? "Loading projects" : "Pick a project";
  return (
    <Select.Root
      collection={collection}
      value={props.reader ? [props.reader.id] : []}
      onValueChange={({ value }) => {
        if (value[0]) props.onPick(value[0]);
      }}
      // Loading keeps it focusable, so the dialog can open on it; the list fills in when read.
      disabled={props.readerFixed}
    >
      <Select.Trigger ref={props.intoRef}>
        <Select.ValueText placeholder={placeholder}>
          {() =>
            props.reader ? (
              <HStack gap={2} minWidth={0}>
                <ProjectAvatar name={props.reader.name} />
                <Text as="span" truncate>
                  {props.reader.name}
                </Text>
              </HStack>
            ) : null
          }
        </Select.ValueText>
      </Select.Trigger>
      <Select.Content>
        {collection.items.map((item) => (
          <Select.Item
            key={item.value}
            item={item}
            aria-label={braidTargetLabel(item.option)}
            data-testid="braid-target"
          >
            <HStack gap={2} minWidth={0} flex={1}>
              <ProjectAvatar name={item.option.name} />
              <Text as="span" truncate>
                {item.option.name}
              </Text>
            </HStack>
            {item.option.reason ? (
              <Text as="span" textStyle="xs" color="fg.muted">
                {item.option.reason}
              </Text>
            ) : null}
          </Select.Item>
        ))}
      </Select.Content>
    </Select.Root>
  );
}

export function BraidRouteFields(props: BraidRouteFieldsProps) {
  return (
    <Stack gap={2}>
      <HStack gap={3} align="start">
        <Field.Root flex={1} minWidth={0}>
          <Field.Label>From</Field.Label>
          <HStack gap={2} height="10" minWidth={0} data-testid="braid-from">
            <ProjectAvatar name={props.owner.name} />
            <Text as="span" textStyle="body" truncate>
              {props.owner.name}
            </Text>
          </HStack>
          <Field.HelperText>Owns the spans</Field.HelperText>
        </Field.Root>
        <RouteArrow />
        <Field.Root flex={1} minWidth={0}>
          <Field.Label>Into</Field.Label>
          <IntoPicker {...props} />
          <Field.HelperText>Sees them in its traces</Field.HelperText>
        </Field.Root>
      </HStack>
      {props.loadFailed ? (
        <Banner
          status="error"
          title="The projects couldn't be loaded"
          action={<BannerAction onClick={props.onRetry}>Try again</BannerAction>}
          data-testid="braid-targets-error"
        >
          Without them there is no project to braid into.
        </Banner>
      ) : null}
      {props.someLeftOut && !props.loadFailed ? (
        <Text textStyle="xs" color="fg.muted" data-testid="braid-targets-note">
          A braid can only go into a project whose traces you can read.
        </Text>
      ) : null}
      {props.listedOnly ? (
        <Text textStyle="xs" color="fg.muted" data-testid="braid-targets-limit-note">
          Only the first {props.listedOnly} projects of the organisation are listed.
        </Text>
      ) : null}
    </Stack>
  );
}
