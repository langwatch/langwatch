import { HStack, IconButton, Text, VStack } from "@chakra-ui/react";
import { ExternalLink, Info } from "lucide-react";

import { Link } from "~/components/ui/link";
import { Popover } from "~/components/ui/popover";

type FieldInfoTooltipProps = {
  description: string;
  docHref?: string;
  docLabel?: string;
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
 * (i) tooltip next to a Field.Label, per rchaves's dogfood feedback:
 * 'every single item should have a little (i) icon with a tooltip
 * explanation, AND a link to read more docs in that tooltip'.
 *
 * Uses Popover (click-triggered) rather than a hover Tooltip so the
 * doc link inside the popover is clickable without racing the close
 * animation. Matches enterprise-UX defaults (same pattern as e.g.
 * Stripe Dashboard and Cloudflare rule editors).
 */
export function FieldInfoTooltip({
  description,
  docHref,
  docLabel = "Read more",
}: FieldInfoTooltipProps) {
  const resolvedHref = docHref ? resolveDocHref(docHref) : undefined;
  const isExternal = resolvedHref ? /^https?:\/\//i.test(resolvedHref) : false;
  return (
    <Popover.Root positioning={{ placement: "right-start" }}>
      <Popover.Trigger asChild>
        <IconButton
          aria-label="More info"
          size="xs"
          variant="ghost"
          color="fg.muted"
          marginLeft={1}
          minWidth="auto"
          height="auto"
          padding={0}
        >
          <Info size={14} />
        </IconButton>
      </Popover.Trigger>
      <Popover.Content maxWidth="sm">
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
