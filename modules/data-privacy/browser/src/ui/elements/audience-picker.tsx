import type { DataPrivacyAudienceOptions } from "@langwatch/data-privacy-contract";
import { createListCollection, HStack, Text } from "@langwatch/design-system/primitives";
import { Select } from "@langwatch/design-system/select";
import { Eye, KeyRound, Shield, User, UserLock, Users } from "lucide-react";
import { useMemo } from "react";

import {
  API_KEYS_EXPLAINER,
  apiKeyLabel,
  unlistedApiKeyLabel,
} from "../../model/audience-api-keys.ts";
import {
  ALL_MEMBERS_VALUE,
  API_KEY_VALUE_PREFIX,
  applyAudienceSelection,
  audienceToSelection,
  PROJECT_OWNER_VALUE,
  ROLE_VALUES,
  selectionToAudience,
  type AudienceFormState,
} from "../../model/data-privacy-rule-config.ts";

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
  if (value.startsWith(API_KEY_VALUE_PREFIX)) return <KeyRound size={14} aria-hidden />;
  return <Users size={14} aria-hidden />;
};

/**
 * The restrict-audience picker, in the scope picker's chip style. "All members"
 * replaces narrower picks and a narrower pick drops it (applyAudienceSelection).
 * Restricted categories also offer API keys by name (ADR-208).
 */
export function AudiencePicker({
  audience,
  options,
  offerApiKeys = false,
  onChange,
}: {
  audience: AudienceFormState;
  options: DataPrivacyAudienceOptions;
  /** True where a content category is restricted; no key reads an attribute rule. */
  offerApiKeys?: boolean;
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
      ...(offerApiKeys ? apiKeyItems({ options, picked: audience.apiKeyIds }) : []),
    ],
    [options, offerApiKeys, audience.apiKeyIds],
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
  const labelFor = (value: string) => {
    if (value === PROJECT_OWNER_VALUE) return "Project owners";
    const label = items.find((item) => item.value === value)?.label;
    if (label) return label;
    return value.startsWith(API_KEY_VALUE_PREFIX)
      ? apiKeyLabel(value.slice(API_KEY_VALUE_PREFIX.length), options)
      : value;
  };
  const roleItems = items.filter((item) =>
    (Object.values(ROLE_VALUES) as string[]).includes(item.value),
  );
  const customItems = items.filter((item) => item.value.startsWith("group:"));
  const keyItems = items.filter((item) => item.value.startsWith(API_KEY_VALUE_PREFIX));
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
        {offerApiKeys && (
          <Select.ItemGroup label="API keys">
            <Text paddingX={2} paddingBottom={1} fontSize="xs" color="fg.muted">
              {API_KEYS_EXPLAINER}
            </Text>
            {keyItems.map((item) => (
              <Select.Item key={item.value} item={item}>
                <HStack gap={2}>
                  <AudienceItemIcon value={item.value} />
                  <Text>{item.label}</Text>
                </HStack>
              </Select.Item>
            ))}
          </Select.ItemGroup>
        )}
      </Select.Content>
    </Select.Root>
  );
}

/** The organization's live keys, plus any the rule names that are not among them. */
function apiKeyItems({
  options,
  picked,
}: {
  options: DataPrivacyAudienceOptions;
  picked: readonly string[];
}): AudienceItem[] {
  // An editor who may not add a key keeps only the ones this rule already names.
  const offered = options.canAddApiKeys
    ? options.apiKeys
    : options.apiKeys.filter((key) => picked.includes(key.id));
  const live = offered.map((key) => ({
    value: `${API_KEY_VALUE_PREFIX}${key.id}`,
    label: key.name,
  }));
  const unlisted = picked
    .filter((id) => !options.apiKeys.some((key) => key.id === id))
    .map((id) => ({ value: `${API_KEY_VALUE_PREFIX}${id}`, label: unlistedApiKeyLabel(options) }));
  if (live.length + unlisted.length > 0) return [...live, ...unlisted];
  return [
    {
      value: `${API_KEY_VALUE_PREFIX}__none`,
      label: options.apiKeysUnavailable
        ? "API keys could not be loaded. Try again shortly"
        : "No API keys to pick: an organization admin can add one",
      disabled: true,
    },
  ];
}
