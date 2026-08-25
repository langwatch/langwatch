import { Button, HStack, Spacer, Text } from "@chakra-ui/react";
import { LuCopy, LuExternalLink } from "react-icons/lu";

export function GroupDrawerHeader({
  groupId,
  tracesUrl,
  logsUrl,
  onCopyGroupId,
}: {
  groupId: string;
  tracesUrl: string | null;
  logsUrl: string | null;
  onCopyGroupId: () => void;
}) {
  return (
    <HStack width="full" gap={2} align="start">
      <Text textStyle="sm" fontFamily="mono" wordBreak="break-all" flexShrink={1}>
        {groupId}
      </Text>
      <Button
        size="2xs"
        variant="ghost"
        aria-label="Copy group ID"
        onClick={onCopyGroupId}
        flexShrink={0}
      >
        <LuCopy size={12} />
      </Button>
      <Spacer />
      {tracesUrl && (
        <Button size="2xs" variant="outline" asChild flexShrink={0}>
          <a href={tracesUrl} target="_blank" rel="noreferrer">
            Traces <LuExternalLink size={11} />
          </a>
        </Button>
      )}
      {logsUrl && (
        <Button size="2xs" variant="outline" asChild flexShrink={0}>
          <a href={logsUrl} target="_blank" rel="noreferrer">
            Logs <LuExternalLink size={11} />
          </a>
        </Button>
      )}
    </HStack>
  );
}
