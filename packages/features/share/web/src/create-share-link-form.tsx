import { Button, createListCollection, Field, HStack, Text, VStack } from "@chakra-ui/react";
import { Checkbox } from "@langwatch/design-system/checkbox";
import { Select } from "@langwatch/design-system/select";
import { shareVisibilitySchema, type ShareVisibility } from "@langwatch/share-contract";
import { useState } from "react";
import { isShareExpiryOption, SHARE_EXPIRY_OPTIONS, type ShareExpiryOption } from "./share-expiry";

const visibilityCollection = createListCollection<{
  value: ShareVisibility;
  label: string;
}>({
  items: [
    { value: "PUBLIC", label: "Anyone with the link" },
    { value: "ORGANIZATION", label: "Members of this organization" },
    { value: "PROJECT", label: "Members of this project" },
  ],
});

const EXPIRY_LABELS: Record<ShareExpiryOption, string> = {
  never: "Never",
  "1h": "In 1 hour",
  "24h": "In 24 hours",
  "7d": "In 7 days",
  "30d": "In 30 days",
};

const expiryCollection = createListCollection<{
  value: ShareExpiryOption;
  label: string;
}>({
  items: SHARE_EXPIRY_OPTIONS.map((value) => ({ value, label: EXPIRY_LABELS[value] })),
});

export interface CreateShareLinkDraft {
  visibility: ShareVisibility;
  expiry: ShareExpiryOption;
  isSingleView: boolean;
}

/** The "mint a new link" controls: audience, expiry, one-time-view + button. */
export function CreateShareLinkForm({
  canCreate,
  isCreating,
  onCreate,
}: {
  /** False while the host has no project to mint against. */
  canCreate: boolean;
  isCreating: boolean;
  onCreate: (draft: CreateShareLinkDraft) => void;
}) {
  const [visibility, setVisibility] = useState<ShareVisibility>("PUBLIC");
  const [expiry, setExpiry] = useState<ShareExpiryOption>("never");
  const [isSingleView, setIsSingleView] = useState(false);

  return (
    <VStack gap={4} align="stretch">
      <HStack gap={3} align="start" flexWrap="wrap">
        <Field.Root flex="2" minWidth="200px">
          <Field.Label>Who can access</Field.Label>
          <Select.Root
            collection={visibilityCollection}
            value={[visibility]}
            onValueChange={(event) => {
              const parsed = shareVisibilitySchema.safeParse(event.value[0]);
              if (parsed.success) {
                setVisibility(parsed.data);
              }
            }}
          >
            <Select.Trigger>
              <Select.ValueText />
            </Select.Trigger>
            <Select.Content>
              {visibilityCollection.items.map((item) => (
                <Select.Item key={item.value} item={item}>
                  {item.label}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        </Field.Root>

        <Field.Root flex="1" minWidth="140px">
          <Field.Label>Expires</Field.Label>
          <Select.Root
            collection={expiryCollection}
            value={[expiry]}
            onValueChange={(event) => {
              const next = event.value[0];
              if (isShareExpiryOption(next)) {
                setExpiry(next);
              }
            }}
          >
            <Select.Trigger>
              <Select.ValueText />
            </Select.Trigger>
            <Select.Content>
              {expiryCollection.items.map((item) => (
                <Select.Item key={item.value} item={item}>
                  {item.label}
                </Select.Item>
              ))}
            </Select.Content>
          </Select.Root>
        </Field.Root>
      </HStack>

      {/* "Include the conversation" is deliberately absent: the share viewer
          cannot render the surrounding thread yet (ADR-057 follow-up), so
          offering the option would promise something the link doesn't deliver.
          Thread sharing is parked server-side too — `createShare` accepts TRACE
          only — so nothing can mint a link this dialog couldn't offer. */}
      <Checkbox
        alignItems="flex-start"
        checked={isSingleView}
        onCheckedChange={(event) => setIsSingleView(!!event.checked)}
      >
        <VStack align="start" gap={0}>
          <Text fontSize="sm">One-time view</Text>
          <Text fontSize="xs" color="fg.muted">
            The link stops working once it has been opened.
          </Text>
        </VStack>
      </Checkbox>

      <HStack justify="end">
        <Button
          colorPalette="orange"
          loading={isCreating}
          disabled={!canCreate}
          onClick={() => onCreate({ visibility, expiry, isSingleView })}
        >
          Create link
        </Button>
      </HStack>
    </VStack>
  );
}
