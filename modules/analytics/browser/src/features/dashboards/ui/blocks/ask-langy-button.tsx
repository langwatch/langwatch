/**
 * A widget's Ask Langy button on a board card, spelled out and always visible: one click
 * hands Langy a ready draft about this widget, the same hand-off picking a widget gives (AC120).
 */

import { Button } from "@langwatch/design-system/primitives";
import { MessageCircle } from "lucide-react";

export function AskLangyButton({ name, onClick }: { name: string; onClick: () => void }) {
  return (
    <Button
      aria-label={`Ask Langy about ${name}`}
      variant="ghost"
      size="xs"
      height={6}
      paddingX={1.5}
      gap={1}
      color="fg.muted"
      fontWeight="normal"
      _hover={{ color: "fg", background: "bg.muted" }}
      onClick={onClick}
    >
      <MessageCircle size={13} aria-hidden />
      Ask Langy
    </Button>
  );
}
