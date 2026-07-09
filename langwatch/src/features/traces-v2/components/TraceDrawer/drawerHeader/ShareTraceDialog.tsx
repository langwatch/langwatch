import {
  Button,
  createListCollection,
  Field,
  HStack,
  Icon,
  IconButton,
  Separator,
  Spinner,
  Text,
  VStack,
} from "@chakra-ui/react";
import type { ShareLink, ShareVisibility } from "@prisma/client";
import { useRef, useState } from "react";
import type { IconType } from "react-icons";
import {
  LuBuilding2,
  LuCopy,
  LuFolderClosed,
  LuGlobe,
  LuTrash2,
} from "react-icons/lu";
import { Checkbox } from "~/components/ui/checkbox";
import { Dialog } from "~/components/ui/dialog";
import { Select } from "~/components/ui/select";
import { toaster } from "~/components/ui/toaster";
import { Tooltip } from "~/components/ui/tooltip";
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

/** Terse labels for the link list — the icon already carries the meaning, and
 *  the full phrasing lives in the "Who can access" select. */
const AUDIENCE: Record<ShareVisibility, { label: string; icon: IconType }> = {
  PUBLIC: { label: "Anyone", icon: LuGlobe },
  ORGANIZATION: { label: "Organization", icon: LuBuilding2 },
  PROJECT: { label: "Project", icon: LuFolderClosed },
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

function ShareLinkRow({
  link,
  isFirst,
  isRevoking,
  onRevoke,
}: {
  link: ShareLink;
  isFirst: boolean;
  isRevoking: boolean;
  onRevoke: () => void;
}) {
  const url = shareUrlForToken(link.token);
  const audience = AUDIENCE[link.visibility];
  const spent = isSpent(link);

  // Mirrors TraceIdChip's copy: `navigator.clipboard` needs a secure context,
  // so self-hosted plain-http domains get a hint rather than a silent no-op.
  const copy = async () => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        toaster.create({
          title: "Link copied",
          description: url,
          type: "success",
          duration: 2500,
          meta: { closable: true },
        });
        return;
      }
      throw new Error("clipboard unavailable");
    } catch {
      toaster.create({
        title: "Couldn't copy the link",
        description:
          "Clipboard access is restricted. This can happen on non-HTTPS domains.",
        type: "error",
        duration: 6000,
        meta: { closable: true },
      });
    }
  };

  return (
    <HStack
      gap={2}
      paddingY={3}
      paddingX={2}
      marginX={-2}
      borderRadius="md"
      borderTopWidth={isFirst ? undefined : "1px"}
      borderColor="border.muted"
      _hover={{ bg: "bg.muted/50" }}
      // A spent link stays visible so it can be revoked, but reads as inert.
      opacity={spent ? 0.55 : 1}
    >
      <VStack align="start" gap={0.5} flex="1" minWidth={0}>
        <Text fontFamily="mono" fontSize="xs" color="fg" truncate width="full">
          {url}
        </Text>
        <HStack gap={1.5} color="fg.muted" fontSize="xs">
          <Icon as={audience.icon} boxSize={3} />
          <Text>{audience.label}</Text>
          <Text aria-hidden>·</Text>
          <Text>{describeLink(link)}</Text>
        </HStack>
      </VStack>

      <Tooltip content="Copy link">
        <IconButton
          aria-label="Copy link"
          variant="ghost"
          size="sm"
          onClick={() => void copy()}
        >
          <Icon as={LuCopy} boxSize={4} />
        </IconButton>
      </Tooltip>
      <Tooltip content="Revoke link">
        <IconButton
          aria-label="Revoke link"
          variant="ghost"
          size="sm"
          colorPalette="red"
          loading={isRevoking}
          onClick={onRevoke}
        >
          <Icon as={LuTrash2} boxSize={4} />
        </IconButton>
      </Tooltip>
    </HStack>
  );
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

  // Park initial focus on the panel itself. Left to its own devices the dialog
  // focuses the close button, which opens with a focus ring drawn around it.
  const contentRef = useRef<HTMLDivElement>(null);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(e) => !e.open && onClose()}
      initialFocusEl={() => contentRef.current}
    >
      <Dialog.Content
        ref={contentRef}
        tabIndex={-1}
        // Translucent glass surface, matching the drawer. A solid fill here
        // would render the backdrop blur inert.
        background="bg.surface/80"
        backdropFilter="blur(25px)"
        borderRadius="lg"
        _focusVisible={{ outline: "none" }}
        onClick={(e) => e.stopPropagation()}
      >
        <Dialog.CloseTrigger />
        <Dialog.Header paddingBottom={0}>
          <VStack align="start" gap={1}>
            <Dialog.Title>Share trace</Dialog.Title>
            <Dialog.Description color="fg.muted" fontSize="sm">
              Create a link to this trace. Revoke it at any time.
            </Dialog.Description>
          </VStack>
        </Dialog.Header>

        <Dialog.Body paddingTop={5} paddingBottom={6}>
          <VStack gap={6} align="stretch">
            <VStack gap={4} align="stretch">
              <HStack gap={3} align="start" flexWrap="wrap">
                <Field.Root flex="2" minWidth="200px">
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

                <Field.Root flex="1" minWidth="140px">
                  <Field.Label>Expires</Field.Label>
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
              </HStack>

              <VStack gap={3} align="stretch">
                <Checkbox
                  alignItems="flex-start"
                  checked={singleView}
                  onCheckedChange={(e) => setSingleView(!!e.checked)}
                >
                  <VStack align="start" gap={0}>
                    <Text fontSize="sm">One-time view</Text>
                    <Text fontSize="xs" color="fg.muted">
                      The link stops working once it has been opened.
                    </Text>
                  </VStack>
                </Checkbox>

                {canShareThread && (
                  <Checkbox
                    alignItems="flex-start"
                    checked={includeThread}
                    onCheckedChange={(e) => setIncludeThread(!!e.checked)}
                  >
                    <VStack align="start" gap={0}>
                      <Text fontSize="sm">Include the conversation</Text>
                      <Text fontSize="xs" color="fg.muted">
                        Viewers also see the other turns in this thread.
                      </Text>
                    </VStack>
                  </Checkbox>
                )}
              </VStack>

              <HStack justify="end">
                <Button
                  colorPalette="orange"
                  loading={isCreating}
                  disabled={!projectId}
                  onClick={() =>
                    createLink({ visibility, expiry, singleView, includeThread })
                  }
                >
                  Create link
                </Button>
              </HStack>
            </VStack>

            <Separator />

            <VStack gap={0} align="stretch">
              <Text
                fontSize="xs"
                fontWeight="600"
                color="fg.muted"
                textTransform="uppercase"
                letterSpacing="wide"
                marginBottom={1}
              >
                Links
              </Text>

              {isLoading ? (
                <HStack color="fg.muted" fontSize="sm" gap={2} paddingY={3}>
                  <Spinner size="sm" />
                  <Text>Loading…</Text>
                </HStack>
              ) : links.length === 0 ? (
                <Text color="fg.muted" fontSize="sm" paddingY={3}>
                  No links yet.
                </Text>
              ) : (
                links.map((link, index) => (
                  <ShareLinkRow
                    key={link.id}
                    link={link}
                    isFirst={index === 0}
                    isRevoking={revokingId === link.id}
                    onRevoke={() => revokeLink(link.id)}
                  />
                ))
              )}
            </VStack>
          </VStack>
        </Dialog.Body>
      </Dialog.Content>
    </Dialog.Root>
  );
}
