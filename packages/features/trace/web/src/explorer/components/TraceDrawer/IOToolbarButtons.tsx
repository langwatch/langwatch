import { Button, Icon } from "@chakra-ui/react";
import { forwardRef, useState } from "react";
import type { IconType } from "react-icons";
import { LuCheck, LuCopy, LuLanguages, LuLightbulb, LuPlay } from "react-icons/lu";
import type { TraceAnchor } from "../../hooks/useAnchoredAnnotations";
import { useCopyToClipboard } from "../../../index";
import { AnnotationPopover } from "./conversationView/AnnotationPopover";

/**
 * The shape every toolbar action wears: icon, label, and the row's height.
 *
 * It stops the click from travelling, because the panel header behind it
 * toggles the panel collapsed.
 */
const ActionButton = forwardRef<
  HTMLButtonElement,
  {
    icon: IconType;
    label: string;
  } & React.ComponentProps<typeof Button>
>(function ActionButton({ icon, label, ...buttonProps }, ref) {
  return (
    <Button
      ref={ref}
      size="xs"
      variant="ghost"
      color="fg.muted"
      gap={1.5}
      paddingX={2}
      height="22px"
      onClick={(e) => e.stopPropagation()}
      {...buttonProps}
    >
      <Icon as={icon} boxSize={3} />
      {label}
    </Button>
  );
});

/**
 * Opens this span in the prompt playground. A real anchor, so the browser's
 * own gestures for a new tab or window still work on it.
 */
export function PlaygroundButton({ href }: { href: string }) {
  return (
    <Button
      asChild
      size="xs"
      variant="ghost"
      color="fg.muted"
      gap={1.5}
      paddingX={2}
      height="22px"
    >
      <a
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        onClick={(e) => e.stopPropagation()}
      >
        <Icon as={LuPlay} boxSize={3} />
        Open in Playground
      </a>
    </Button>
  );
}

/** Opens the annotation composer in `suggest` mode against this field. */
export function SuggestCorrectionButton({
  traceId,
  output,
  anchor,
}: {
  traceId: string;
  output: string;
  /** The field the suggestion corrects. */
  anchor: TraceAnchor;
}) {
  const [open, setOpen] = useState(false);
  return (
    <AnnotationPopover
      traceId={traceId}
      output={output}
      mode="suggest"
      anchorKind={anchor.anchorKind}
      anchorId={anchor.anchorId}
      anchorPath={anchor.anchorPath}
      open={open}
      onOpenChange={setOpen}
      trigger={<ActionButton icon={LuLightbulb} label="Suggest edit" />}
    />
  );
}

/**
 * Turns the translated view on and off. The label is the whole state: what it
 * offers next while idle, and what it is doing while the request is out.
 */
export function TranslateButton({
  isActive,
  isLoading,
  onToggle,
}: {
  isActive: boolean;
  isLoading: boolean;
  onToggle: () => void;
}) {
  return (
    <ActionButton
      icon={LuLanguages}
      label={isLoading ? "Translating…" : isActive ? "Show original" : "Translate"}
      aria-pressed={isActive}
      color={isActive ? "blue.fg" : "fg.muted"}
      disabled={isLoading}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    />
  );
}

/**
 * Copies what the panel currently displays, and says so with a check for a
 * moment. Icon only: it is the last control in the row and needs no width.
 */
export function CopyButton({ text }: { text: string }) {
  const { copied, copy } = useCopyToClipboard();

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    copy(text);
  };

  return (
    <Button
      size="xs"
      variant="ghost"
      onClick={handleCopy}
      aria-label="Copy to clipboard"
      padding={0}
      minWidth="auto"
      height="auto"
    >
      <Icon
        as={copied ? LuCheck : LuCopy}
        boxSize={3}
        color={copied ? "green.fg" : "fg.subtle"}
      />
    </Button>
  );
}
