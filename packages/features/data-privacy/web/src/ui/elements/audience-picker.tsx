import { createListCollection, HStack, Text } from "@chakra-ui/react";
import type { DataPrivacyAudienceOptions } from "@langwatch/data-privacy-contract";
import { Select } from "@langwatch/design-system/select";
import { Eye, Shield, User, UserLock, Users } from "lucide-react";
import { useMemo } from "react";
import {
  ALL_MEMBERS_VALUE,
  applyAudienceSelection,
  audienceToSelection,
  PROJECT_OWNER_VALUE,
  ROLE_VALUES,
  selectionToAudience,
  type AudienceFormState,
} from "../../model/data-privacy-rule-config";

interface AudienceItem {
  value: string;
  label: string;
  disabled?: boolean;
}

const AudienceItemIcon = ({ value }: { value: string }) => {
  if (value === ALL_MEMBERS_VALUE) return <Users size={14} aria-hidden />;
  if (value === PROJECT_OWNER_VALUE) return <UserLock size={14} aria-hidden />;
  if (value === ROLE_VALUES.admins) return <Shield size={14} aria-hidden />;
  if (value === ROLE_VALUES.viewers) return <Eye size={14} aria-hidden />;
  if (value === ROLE_VALUES.members) return <User size={14} aria-hidden />;
  return <Users size={14} aria-hidden />;
};

/**
 * The restrict-audience picker: one multi-select of groups, in the same chip
 * style as the scope picker. "All members" already covers everyone with
 * access, so picking it replaces the selection and picking anything narrower
 * drops it (see applyAudienceSelection).
 */
export function AudiencePicker({
  audience,
  options,
  onChange,
}: {
  audience: AudienceFormState;
  options: DataPrivacyAudienceOptions;
  onChange: (next: AudienceFormState) => void;
}) {
  const items = useMemo<AudienceItem[]>(
    () => [
      { value: ALL_MEMBERS_VALUE, label: "All members" },
      {
        value: PROJECT_OWNER_VALUE,
        label: "Project owners (their own personal projects)",
      },
      { value: ROLE_VALUES.admins, label: "Admins" },
      { value: ROLE_VALUES.members, label: "Members" },
      { value: ROLE_VALUES.viewers, label: "Viewers" },
      ...(options.groups.length > 0
        ? options.groups.map((group) => ({
            value: `group:${group.id}`,
            label: group.name,
          }))
        : [
            {
              value: "group:__none",
              label: "No custom groups in this organization yet",
              disabled: true,
            },
          ]),
    ],
    [options.groups],
  );
  const collection = useMemo(
    () =>
      createListCollection({
        items,
        isItemDisabled: (item) => item.disabled === true,
      }),
    [items],
  );
  const selected = audienceToSelection(audience);
  const labelFor = (value: string) =>
    value === PROJECT_OWNER_VALUE
      ? "Project owners"
      : (items.find((item) => item.value === value)?.label ?? value);
  const roleItems = items.filter((item) =>
    (Object.values(ROLE_VALUES) as string[]).includes(item.value),
  );
  const customItems = items.filter((item) => item.value.startsWith("group:"));
  return (
    <Select.Root
      collection={collection}
      value={selected}
      multiple
      size="sm"
      onValueChange={(details) =>
        onChange(selectionToAudience(applyAudienceSelection(selected, details.value)))
      }
    >
      <Select.Trigger background="bg" aria-label="Restricted content is visible to">
        <Select.ValueText placeholder="No one (fully hidden)">
          {() =>
            selected.length > 0 ? (
              <HStack gap={1.5} flexWrap="wrap">
                {selected.map((value) => (
                  <HStack
                    key={value}
                    gap={1}
                    paddingX={1.5}
                    borderWidth="1px"
                    borderRadius="md"
                    fontSize="xs"
                  >
                    <AudienceItemIcon value={value} />
                    <Text>{labelFor(value)}</Text>
                  </HStack>
                ))}
              </HStack>
            ) : (
              "No one (fully hidden)"
            )
          }
        </Select.ValueText>
      </Select.Trigger>
      <Select.Content>
        <Select.ItemGroup label="Everyone">
          <Select.Item item={items[0]}>
            <HStack gap={2}>
              <AudienceItemIcon value={ALL_MEMBERS_VALUE} />
              <Text>All members</Text>
            </HStack>
          </Select.Item>
        </Select.ItemGroup>
        <Select.ItemGroup label="Project owners">
          <Select.Item item={items[1]}>
            <HStack gap={2}>
              <AudienceItemIcon value={PROJECT_OWNER_VALUE} />
              <Text>Project owners (their own personal projects)</Text>
            </HStack>
          </Select.Item>
        </Select.ItemGroup>
        <Select.ItemGroup label="Role groups">
          {roleItems.map((item) => (
            <Select.Item key={item.value} item={item}>
              <HStack gap={2}>
                <AudienceItemIcon value={item.value} />
                <Text>{item.label}</Text>
              </HStack>
            </Select.Item>
          ))}
        </Select.ItemGroup>
        <Select.ItemGroup label="Custom groups">
          {customItems.map((item) => (
            <Select.Item key={item.value} item={item}>
              <HStack gap={2}>
                <AudienceItemIcon value={item.value} />
                <Text>{item.label}</Text>
              </HStack>
            </Select.Item>
          ))}
        </Select.ItemGroup>
      </Select.Content>
    </Select.Root>
  );
}
