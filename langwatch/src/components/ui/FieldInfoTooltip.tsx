import { HStack, IconButton, Text, VStack } from "@chakra-ui/react";
import { ExternalLink, Info } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Link } from "~/components/ui/link";
import { Popover } from "~/components/ui/popover";

type FieldInfoTooltipProps = {
  description: string;
  docHref?: string;
  docLabel?: string;
  /** Distinguishes one (i) from the next when a form has several. */
  testId?: string;
};

/**
 * Published docs site root. `docHref` values that start with "/" are
 * resolved against this base (e.g. `/ai-gateway/virtual-keys#format`
 * → `https://langwatch.ai/docs/ai-gateway/virtual-keys#format`).
 * Absolute `http(s)://…` hrefs pass through unchanged so the few
 * off-site deep links (blog posts, vendor docs) still work.
 *
 * Tracking to preserve: previous iters passed bare relative paths
 * here which resolved against the app domain (localhost:5560,
 * app.langwatch.ai) — all those links 404'd. rchaves's dogfood pass
 * in iter 64 caught it.
 */
const DOCS_BASE = "https://langwatch.ai/docs";

function resolveDocHref(href: string): string {
  if (/^https?:\/\//i.test(href)) return href;
  if (href.startsWith("/")) return `${DOCS_BASE}${href}`;
  return `${DOCS_BASE}/${href}`;
}

/**
 * (i) tooltip next to a field label, per rchaves's dogfood feedback:
 * 'every single item should have a little (i) icon with a tooltip
 * explanation, AND a link to read more docs in that tooltip'.
 *
 * Keeps a form scannable: the label says what the setting is, the tooltip
 * carries the paragraph explaining why you'd want it. See
 * `dev/docs/best_practices/copywriting.md` — descriptions stay short, the
 * long form goes behind the (i).
 *
 * Opens while the pointer is over the (i), and closes when it leaves. It also
 * stays open while the pointer is over the popover itself, so the doc link
 * inside stays clickable — a plain hover Tooltip closes the moment the pointer
 * leaves the icon, putting the link out of reach. Crossing the gap between the
 * two gets a short grace period. Click still opens it, for touch.
 *
 * `autoFocus` is off: Chakra focuses the popover body when it opens, which
 * blurs the trigger. With an onBlur that closes, that produced a visible
 * open/close flicker on every hover.
 */

/** Grace period before a hover-out closes, so crossing the gap doesn't. */
const HOVER_CLOSE_DELAY_MS = 150;

export function FieldInfoTooltip({
  description,
  docHref,
  docLabel = "Read more",
  testId,
}: FieldInfoTooltipProps) {
  const resolvedHref = docHref ? resolveDocHref(docHref) : undefined;
  const isExternal = resolvedHref ? /^https?:\/\//i.test(resolvedHref) : false;

  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
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
      open={open}
      // The trigger toggles on click, which on a mouse means hovering the (i)
      // opens it and then clicking it shuts it again. Refuse a close while the
      // pointer is still on the icon; Escape and clicking away still close,
      // since the pointer has left by then.
      onOpenChange={(details) => {
        if (!details.open && pointerOverTrigger.current) return;
        setOpen(details.open);
      }}
      autoFocus={false}
      positioning={{ placement: "right-start", gutter: 8 }}
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
          onMouseEnter={() => {
            pointerOverTrigger.current = true;
            openNow();
          }}
          onMouseLeave={() => {
            pointerOverTrigger.current = false;
            closeSoon();
          }}
        >
          <Info size={14} />
        </IconButton>
      </Popover.Trigger>
      <Popover.Content
        maxWidth="sm"
        onMouseEnter={cancelClose}
        onMouseLeave={closeSoon}
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
                isExternal={isExternal}
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
