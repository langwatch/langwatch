import { DetailDrawerHeader } from "@langwatch/design-system/detail-drawer-header";
import { Button } from "@langwatch/design-system/primitives";
import { Copy, ExternalLink } from "lucide-react";

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
    <DetailDrawerHeader kind="Queue group" title={groupId}>
      <Button
        size="2xs"
        variant="ghost"
        aria-label="Copy group ID"
        onClick={onCopyGroupId}
        flexShrink={0}
      >
        <Copy size={12} />
      </Button>
      {tracesUrl && (
        <Button size="2xs" variant="outline" asChild flexShrink={0}>
          <a href={tracesUrl} target="_blank" rel="noreferrer">
            Traces <ExternalLink size={11} />
          </a>
        </Button>
      )}
      {logsUrl && (
        <Button size="2xs" variant="outline" asChild flexShrink={0}>
          <a href={logsUrl} target="_blank" rel="noreferrer">
            Logs <ExternalLink size={11} />
          </a>
        </Button>
      )}
    </DetailDrawerHeader>
  );
}
