import {
  Badge,
  Button,
  createListCollection,
  Field,
  HStack,
  IconButton,
  Separator,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import type { ShareLink } from "@prisma/client";
import { useState } from "react";
import { LuTrash2 } from "react-icons/lu";
import { CopyInput } from "~/components/CopyInput";
import { Checkbox } from "~/components/ui/checkbox";
import { Dialog } from "~/components/ui/dialog";
import { Select } from "~/components/ui/select";
import {
  type ShareExpiryOption,
  type ShareVisibilityOption,
  shareUrlForToken,
  useShareTrace,
} from "../../../hooks/useShareTrace";

const visibilityCollection = createListCollection<{
  value: ShareVisibilityOption;
  label: string;
}>({
  items: [
    { value: "PUBLIC", label: "Anyone with the link" },
    { value: "ORGANIZATION", label: "Members of this organization" },
    { value: "PROJECT", label: "Members of this project" },
  ],
});

const expiryCollection = createListCollection<{
  value: ShareExpiryOption;
  label: string;
}>({
  items: [
    { value: "never", label: "Never" },
    { value: "1h", label: "1 hour" },
    { value: "24h", label: "24 hours" },
    { value: "7d", label: "7 days" },
    { value: "30d", label: "30 days" },
  ],
});

const VISIBILITY_LABEL: Record<ShareVisibilityOption, string> = {
  PUBLIC: "Public",
  ORGANIZATION: "Organization",
  PROJECT: "Project",
};

function describeLink(link: ShareLink): string {
  const parts: string[] = [];
  if (link.maxViews === 1) {
    parts.push("One-time");
  } else if (link.maxViews != null) {
    parts.push(`${link.viewCount}/${link.maxViews} views`);
  }
  if (link.expiresAt) {
    const expired = link.expiresAt.getTime() <= Date.now();
    parts.push(
      expired
        ? "Expired"
        : `Expires ${link.expiresAt.toLocaleDateString()}`,
    );
  } else {
    parts.push("No expiry");
  }
  return parts.join(" · ");
}

export function ShareTraceDialog({
  open,
  onClose,
  projectId,
  traceId,
  conversationId,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string | undefined;
  traceId: string;
  conversationId: string | null;
}) {
  const {
    links,
    isLoading,
    createLink,
    isCreating,
    revokeLink,
    isRevoking,
    canShareThread,
  } = useShareTrace({ projectId, traceId, conversationId, active: open });

  const [visibility, setVisibility] = useState<ShareVisibilityOption>("PUBLIC");
  const [expiry, setExpiry] = useState<ShareExpiryOption>("never");
  const [singleView, setSingleView] = useState(false);
  const [includeThread, setIncludeThread] = useState(false);

  return (
    <Dialog.Root open={open} onOpenChange={(e) => !e.open && onClose()}>
      <Dialog.Content bg="bg" onClick={(e) => e.stopPropagation()}>
        <Dialog.Header>
          <Dialog.Title>Share trace</Dialog.Title>
        </Dialog.Header>
        <Dialog.Body paddingBottom={6}>
          <VStack gap={5} align="stretch">
            <VStack gap={3} align="stretch">
              <Field.Root>
                <Field.Label>Who can access</Field.Label>
                <Select.Root
                  collection={visibilityCollection}
                  value={[visibility]}
                  onValueChange={(e) =>
                    setVisibility(e.value[0] as ShareVisibilityOption)
                  }
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

              <Field.Root>
                <Field.Label>Link expires</Field.Label>
                <Select.Root
                  collection={expiryCollection}
                  value={[expiry]}
                  onValueChange={(e) =>
                    setExpiry(e.value[0] as ShareExpiryOption)
                  }
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

              <Checkbox
                checked={singleView}
                onCheckedChange={(e) => setSingleView(!!e.checked)}
              >
                One-time view — the link works once, then stops
              </Checkbox>

              {canShareThread && (
                <Checkbox
                  checked={includeThread}
                  onCheckedChange={(e) => setIncludeThread(!!e.checked)}
                >
                  Include the full conversation
                </Checkbox>
              )}

              <Button
                colorPalette="orange"
                alignSelf="start"
                loading={isCreating}
                disabled={!projectId}
                onClick={() =>
                  createLink({ visibility, expiry, singleView, includeThread })
                }
              >
                Create link
              </Button>
            </VStack>

            <Separator />

            <VStack gap={2} align="stretch">
              <Text fontWeight="600" fontSize="sm">
                Active links
              </Text>
              {isLoading ? (
                <HStack color="fg.muted" fontSize="sm">
                  <Spinner size="sm" />
                  <Text>Loading…</Text>
                </HStack>
              ) : links.length === 0 ? (
                <Text color="fg.muted" fontSize="sm">
                  No active links yet.
                </Text>
              ) : (
                links.map((link) => (
                  <VStack
                    key={link.id}
                    align="stretch"
                    gap={1}
                    borderWidth="1px"
                    borderColor="border"
                    borderRadius="md"
                    padding={3}
                  >
                    <HStack width="full">
                      <CopyInput
                        value={shareUrlForToken(link.token)}
                        label="Share link"
                      />
                      <IconButton
                        aria-label="Revoke link"
                        variant="ghost"
                        colorPalette="red"
                        loading={isRevoking}
                        onClick={() => revokeLink(link.id)}
                      >
                        <LuTrash2 size={16} />
                      </IconButton>
                    </HStack>
                    <HStack gap={2}>
                      <Badge colorPalette="gray">
                        {VISIBILITY_LABEL[link.visibility]}
                      </Badge>
                      <Text fontSize="xs" color="fg.muted">
                        {describeLink(link)}
                      </Text>
                    </HStack>
                  </VStack>
                ))
              )}
            </VStack>
          </VStack>
        </Dialog.Body>
        <Dialog.Footer>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
