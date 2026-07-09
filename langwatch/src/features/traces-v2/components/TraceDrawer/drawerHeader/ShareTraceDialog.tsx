import {
  Badge,
  Box,
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
import type { ShareLink, ShareVisibility } from "@prisma/client";
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
    { value: "1h", label: "In 1 hour" },
    { value: "24h", label: "In 24 hours" },
    { value: "7d", label: "In 7 days" },
    { value: "30d", label: "In 30 days" },
  ],
});

const VISIBILITY_BADGE: Record<
  ShareVisibility,
  { label: string; colorPalette: string }
> = {
  PUBLIC: { label: "Anyone", colorPalette: "orange" },
  ORGANIZATION: { label: "Organization", colorPalette: "blue" },
  PROJECT: { label: "Project", colorPalette: "gray" },
};

/** A link stops working once it expires or its view cap is spent. */
function isSpent(link: ShareLink): boolean {
  const expired = !!link.expiresAt && link.expiresAt.getTime() <= Date.now();
  const consumed = link.maxViews != null && link.viewCount >= link.maxViews;
  return expired || consumed;
}

function describeLink(link: ShareLink): string {
  const parts: string[] = [];

  if (link.maxViews === 1) {
    parts.push(link.viewCount >= 1 ? "Opened" : "Opens once");
  } else if (link.maxViews != null) {
    parts.push(`${link.viewCount} of ${link.maxViews} views`);
  }

  if (!link.expiresAt) {
    parts.push("No expiry");
  } else if (link.expiresAt.getTime() <= Date.now()) {
    parts.push("Expired");
  } else {
    parts.push(`Expires ${link.expiresAt.toLocaleDateString()}`);
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
    revokingId,
    canShareThread,
  } = useShareTrace({ projectId, traceId, conversationId, active: open });

  const [visibility, setVisibility] = useState<ShareVisibilityOption>("PUBLIC");
  const [expiry, setExpiry] = useState<ShareExpiryOption>("never");
  const [singleView, setSingleView] = useState(false);
  const [includeThread, setIncludeThread] = useState(false);

  return (
    <Dialog.Root open={open} onOpenChange={(e) => !e.open && onClose()}>
      <Dialog.Content
        // Translucent glass surface, matching the drawer. A solid fill here
        // would render the backdrop blur inert.
        background="bg.surface/80"
        backdropFilter="blur(25px)"
        borderRadius="lg"
        onClick={(e) => e.stopPropagation()}
      >
        <Dialog.CloseTrigger />
        <Dialog.Header>
          <Dialog.Title>Share trace</Dialog.Title>
          <Dialog.Description color="fg.muted" fontSize="sm">
            Create a link to this trace. Revoke it at any time.
          </Dialog.Description>
        </Dialog.Header>

        <Dialog.Body paddingBottom={6}>
          <VStack gap={5} align="stretch">
            <Box
              bg="bg.panel/60"
              borderWidth="1px"
              borderColor="border"
              borderRadius="md"
              padding={4}
            >
              <VStack gap={4} align="stretch">
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

                <VStack gap={2} align="stretch">
                  <Checkbox
                    checked={singleView}
                    onCheckedChange={(e) => setSingleView(!!e.checked)}
                  >
                    <Text fontSize="sm">One-time view</Text>
                  </Checkbox>
                  <Text fontSize="xs" color="fg.muted" paddingLeft={6}>
                    The link stops working once it has been opened.
                  </Text>

                  {canShareThread && (
                    <>
                      <Checkbox
                        checked={includeThread}
                        onCheckedChange={(e) => setIncludeThread(!!e.checked)}
                      >
                        <Text fontSize="sm">Include the conversation</Text>
                      </Checkbox>
                      <Text fontSize="xs" color="fg.muted" paddingLeft={6}>
                        Viewers also see the other turns in this thread.
                      </Text>
                    </>
                  )}
                </VStack>

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
            </Box>

            <Separator />

            <VStack gap={2} align="stretch">
              <Text fontWeight="600" fontSize="sm">
                Links
              </Text>

              {isLoading ? (
                <HStack color="fg.muted" fontSize="sm" gap={2}>
                  <Spinner size="sm" />
                  <Text>Loading…</Text>
                </HStack>
              ) : links.length === 0 ? (
                <Text color="fg.muted" fontSize="sm">
                  No links yet.
                </Text>
              ) : (
                links.map((link) => {
                  const spent = isSpent(link);
                  const badge = VISIBILITY_BADGE[link.visibility];
                  return (
                    <VStack
                      key={link.id}
                      align="stretch"
                      gap={2}
                      bg="bg.panel/60"
                      borderWidth="1px"
                      borderColor="border"
                      borderRadius="md"
                      padding={3}
                      // A spent link is kept visible so it can be revoked, but
                      // reads as inert.
                      opacity={spent ? 0.6 : 1}
                    >
                      <HStack width="full" gap={2}>
                        <CopyInput
                          value={shareUrlForToken(link.token)}
                          label="Share link"
                        />
                        <IconButton
                          aria-label="Revoke link"
                          variant="ghost"
                          size="sm"
                          colorPalette="red"
                          loading={revokingId === link.id}
                          onClick={() => revokeLink(link.id)}
                        >
                          <LuTrash2 size={16} />
                        </IconButton>
                      </HStack>
                      <HStack gap={2}>
                        <Badge
                          colorPalette={badge.colorPalette}
                          variant="subtle"
                          size="sm"
                        >
                          {badge.label}
                        </Badge>
                        <Text fontSize="xs" color="fg.muted">
                          {describeLink(link)}
                        </Text>
                      </HStack>
                    </VStack>
                  );
                })
              )}
            </VStack>
          </VStack>
        </Dialog.Body>

        <Dialog.Footer>
          <Button variant="ghost" onClick={onClose}>
            Done
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
