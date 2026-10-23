import { Alert, Badge, HStack, Link, Text } from "@langwatch/design-system/primitives";
import { ExternalLink } from "lucide-react";

import type { UpgradeNoticeView } from "../../model/upgrade-view.ts";

/** How each severity draws; only a security notice carries a mark beside its title. */
const SEVERITY_LOOK = {
  security: { status: "error", mark: "Security" },
  warning: { status: "warning", mark: null },
  info: { status: "info", mark: null },
} as const;

/** One notice cloud sent: its title, body, the release that fixes it and its link. */
export function UpgradeNotice({ notice }: { notice: UpgradeNoticeView }) {
  const look = SEVERITY_LOOK[notice.severity];
  return (
    <Alert.Root status={look.status} data-testid="upgrade-notice">
      <Alert.Indicator />
      <Alert.Content gap={1}>
        <HStack gap={2} flexWrap="wrap">
          {look.mark && (
            <Badge colorPalette="red" size="sm">
              {look.mark}
            </Badge>
          )}
          <Alert.Title>{notice.title}</Alert.Title>
        </HStack>
        {notice.body && <Alert.Description whiteSpace="pre-wrap">{notice.body}</Alert.Description>}
        {(notice.fixed_in || notice.url) && (
          <HStack gap={3} flexWrap="wrap">
            {notice.fixed_in && <Text textStyle="sm">Fixed in {notice.fixed_in}</Text>}
            {notice.url && (
              <Link href={notice.url} target="_blank" rel="noopener noreferrer" textStyle="sm">
                Read more <ExternalLink size={12} />
              </Link>
            )}
          </HStack>
        )}
      </Alert.Content>
    </Alert.Root>
  );
}
