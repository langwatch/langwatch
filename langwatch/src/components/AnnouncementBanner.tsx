import { Alert, Button, CloseButton, HStack, Text } from "@chakra-ui/react";
import { useLocalStorage } from "usehooks-ts";
import { LuArrowRight } from "react-icons/lu";

export type Announcement = {
  /** Unique key used for localStorage dismiss state */
  id: string;
  message: string;
  linkUrl: string;
  linkLabel?: string;
  /** Banner auto-hides on or after this date */
  expiresAt: Date;
};

const announcements: Announcement[] = [
  {
    id: "litellm-vulnerability-2026-03",
    message:
      "Your data is safe — LangWatch was not affected by the recent LiteLLM vulnerability.",
    linkUrl:
      "https://langwatch.ai/blog/a-note-on-the-litellm-vulnerability",
    linkLabel: "Read our full statement",
    expiresAt: new Date("2026-03-27T00:00:00Z"),
  },
];

function AnnouncementItem({ announcement }: { announcement: Announcement }) {
  const [dismissed, setDismissed] = useLocalStorage(
    `langwatch-announcement-${announcement.id}-dismissed`,
    false,
  );

  if (dismissed || new Date() >= announcement.expiresAt) {
    return null;
  }

  return (
    <Alert.Root
      status="info"
      width="full"
      border="1px solid"
      borderColor="colorPalette.muted"
      // Top-left only — matches the inner page chrome's rounded
      // top-left corner (`borderTopLeftRadius="xl"`) so the banner's
      // curve continues from the chrome. All other corners flush.
      borderRadius={0}
      borderTopLeftRadius="xl"
    >
      <Alert.Indicator />
      <Alert.Content>
        <HStack width="full">
          <Text>{announcement.message}</Text>
          <Button
            size="xs"
            variant="outline"
            colorPalette="blue"
            asChild
          >
            <a
              href={announcement.linkUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {announcement.linkLabel ?? "Learn more"}{" "}
              <LuArrowRight size={12} />
            </a>
          </Button>
        </HStack>
      </Alert.Content>
      <CloseButton
        size="sm"
        position="absolute"
        right={2}
        top={2}
        onClick={() => setDismissed(true)}
      />
    </Alert.Root>
  );
}

export function AnnouncementBanner() {
  return (
    <>
      {announcements.map((a) => (
        <AnnouncementItem key={a.id} announcement={a} />
      ))}
    </>
  );
}
