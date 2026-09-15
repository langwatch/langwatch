import { HStack, IconButton, Link, Text, VStack } from "@chakra-ui/react";
import { ExternalLink, Info } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Popover } from "./popover.tsx";

type FieldInfoTooltipProps = {
  description: string;
  docHref?: string;
  docLabel?: string;
  /** Distinguishes one (i) from the next when a form has several. */
  testId?: string;
  /**
   * "click" (default) matches every existing caller's original behavior —
   * plain click-to-toggle, no hover handling. Only opt into "hover" where a
   * caller actually needs it (the Comparison form, where several (i)s sit
   * close together and a click-only affordance felt slow to scan). Defaulting
   * to "click" means this component's interaction model can't silently change
   * for every other form just because one caller needed hover.
   */
  trigger?: "click" | "hover";
};

/** Docs URL base: "/" and relative paths resolve here; absolute URLs pass through. */
const DOCS_BASE = "https://langwatch.ai/docs";

function resolveDocHref(href: string): string {
  if (/^https?:\/\//i.test(href)) return href;
  if (href.startsWith("/")) return `${DOCS_BASE}${href}`;
  return `${DOCS_BASE}/${href}`;
}

/**
 * Label says what, tooltip explains why and links to docs. Default trigger="click"
 * (plain toggle). trigger="hover" opens on pointer over icon/popover with grace period
 * to keep links clickable; autoFocus off to prevent flicker.
 */

/** Grace period before a hover-out closes, so crossing the gap doesn't. */
const HOVER_CLOSE_DELAY_MS = 150;

export function FieldInfoTooltip({
  description,
  docHref,
  docLabel = "Read more",
  testId,
  trigger = "click",
}: FieldInfoTooltipProps) {
  const resolvedHref = docHref ? resolveDocHref(docHref) : undefined;
  const isExternal = resolvedHref ? /^https?:\/\//i.test(resolvedHref) : false;
  const isHover = trigger === "hover";

  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pointerOverTrigger = useRef(false);

  const cancelClose = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = undefined;
  }, []);

  const openNow = useCallback(() => {
    cancelClose();
    setOpen(true);
  }, [cancelClose]);

  const closeSoon = useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), HOVER_CLOSE_DELAY_MS);
  }, [cancelClose]);

  // A pending close would fire after unmount and set state on a dead component.
  useEffect(() => cancelClose, [cancelClose]);

  return (
    <Popover.Root
      {...(isHover
        ? {
            open,
            // The trigger toggles on click, which on a mouse means hovering
            // the (i) opens it and then clicking it shuts it again. Refuse a
            // close while the pointer is still on the icon; Escape and
            // clicking away still close, since the pointer has left by then.
            onOpenChange: (details: { open: boolean }) => {
              if (!details.open && pointerOverTrigger.current) return;
              setOpen(details.open);
            },
            autoFocus: false,
          }
        : {})}
      // gutter only in hover mode (the wider gap keeps the pointer from
      // crossing an empty seam and closing mid-hover). Click mode keeps the
      // original positioning exactly, so the existing gateway callers are
      // pixel-identical to before this component moved.
      positioning={{
        placement: "right-start",
        ...(isHover && { gutter: 8 }),
      }}
    >
      <Popover.Trigger asChild>
        <IconButton
          aria-label="More info"
          data-testid={testId}
          size="xs"
          variant="ghost"
          color="fg.muted"
          marginLeft={1}
          minWidth="auto"
          height="auto"
          padding={0}
          {...(isHover
            ? {
                onMouseEnter: () => {
                  pointerOverTrigger.current = true;
                  openNow();
                },
                onMouseLeave: () => {
                  pointerOverTrigger.current = false;
                  closeSoon();
                },
              }
            : {})}
        >
          <Info size={14} />
        </IconButton>
      </Popover.Trigger>
      <Popover.Content
        maxWidth="sm"
        {...(isHover ? { onMouseEnter: cancelClose, onMouseLeave: closeSoon } : {})}
      >
        <Popover.Arrow>
          <Popover.ArrowTip />
        </Popover.Arrow>
        <Popover.Body>
          <VStack align="stretch" gap={2}>
            <Text fontSize="sm">{description}</Text>
            {resolvedHref && (
              <Link
                href={resolvedHref}
                color="orange.600"
                fontSize="xs"
                fontWeight="medium"
                // `resolveDocHref` always yields an absolute docs URL, so this
                // is an off-site link every time. The condition stays because
                // it is the same condition that decides the trailing glyph:
                // one answer, read twice, cannot disagree with itself.
                {...(isExternal ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              >
                <HStack gap={1} display="inline-flex">
                  <Text as="span">{docLabel}</Text>
                  {isExternal && <ExternalLink size={10} />}
                </HStack>
              </Link>
            )}
          </VStack>
        </Popover.Body>
      </Popover.Content>
    </Popover.Root>
  );
}
