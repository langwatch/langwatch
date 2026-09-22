import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { isAppPath, toRelativeSameOriginHref } from "@langwatch/langy-contract";
import { ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";

import {
  type CapabilityIconName,
  type CapabilitySurface,
} from "../../../../../model/langy-capability-catalog.ts";
import {
  CapabilityRowSkeletons,
  LangyCapabilityCard as LangyCapabilityCardPresentation,
  type LangyCapabilityTone,
} from "../../../../../ui/sections/langy-capability-card.tsx";
import { useSpaLinkClick } from "../../../behavior/logic/spa-link.ts";
import {
  buildSurfaceHref,
  SURFACE_LABEL,
} from "../../../model/capabilities/capability-registry.ts";
import { LangySpaAnchor } from "../langy-spa-anchor.tsx";

export { CapabilityRowSkeletons };

type CapabilityCardProps = {
  tone: LangyCapabilityTone;
  surface: CapabilitySurface;
  overline: string;
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  deepLink?: boolean;
  projectSlug?: string | null;
  resourceId?: string | null;
  platformUrl?: string | null;
  /**
   * A link the result itself answered with (a page action that ran with no
   * page open answers where to see its effect), as an app path. Wins over
   * `platformUrl` and the rebuilt surface href.
   */
  deepLinkHref?: string | null;
  /** The copy for that link, when the result names its own. */
  deepLinkLabel?: string | null;
  icon?: CapabilityIconName;
};

/** App adapter: reusable card presentation plus this app's SPA navigation. */
export function LangyCapabilityCard({
  actions,
  deepLink = true,
  deepLinkHref,
  deepLinkLabel,
  platformUrl,
  projectSlug,
  resourceId,
  surface,
  ...presentation
}: CapabilityCardProps) {
  const footer =
    deepLink || actions ? (
      <HStack gap={2} justify="space-between" align="center" flexWrap="wrap">
        <Box>{actions}</Box>
        {deepLink ? (
          <CapabilityDeepLinkChip
            surface={surface}
            projectSlug={projectSlug}
            resourceId={resourceId}
            platformUrl={platformUrl}
            appHref={deepLinkHref}
            label={deepLinkLabel ?? void 0}
          />
        ) : null}
      </HStack>
    ) : null;

  return <LangyCapabilityCardPresentation {...presentation} surface={surface} footer={footer} />;
}

function CapabilityDeepLinkChip({
  surface,
  projectSlug,
  resourceId,
  platformUrl,
  appHref,
  label,
}: {
  surface: CapabilitySurface;
  projectSlug?: string | null;
  resourceId?: string | null;
  platformUrl?: string | null;
  /** An app path the result answered with. Anything else is ignored. */
  appHref?: string | null;
  /** Override the default "Open in <surface>" copy. */
  label?: string;
}) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const preciseHref = platformUrl ? toRelativeSameOriginHref({ url: platformUrl, origin }) : null;
  const href =
    (isAppPath(appHref) ? appHref : null) ??
    preciseHref ??
    buildSurfaceHref({ surface, projectSlug, resourceId });
  const onClick = useSpaLinkClick(href ?? "");
  if (!href) return null;

  return (
    <LangySpaAnchor
      href={href}
      display="inline-flex"
      alignItems="center"
      gap={1}
      textStyle="xs"
      fontWeight="560"
      color="orange.solid"
      marginLeft="auto"
      _hover={{ textDecoration: "underline" }}
      onClick={onClick}
    >
      {label ?? `Open in ${SURFACE_LABEL[surface]}`}
      <ArrowUpRight size={12} />
    </LangySpaAnchor>
  );
}

export function CapabilityRow({
  href,
  primary,
  secondary,
}: {
  href?: string | null;
  primary: ReactNode;
  secondary?: ReactNode;
}) {
  const body = (
    <VStack align="stretch" gap={0} flex={1} minWidth={0}>
      <Text textStyle="xs" color="fg" truncate>
        {primary}
      </Text>
      {secondary !== undefined && secondary !== null ? (
        <Text textStyle="2xs" color="fg.muted" truncate>
          {secondary}
        </Text>
      ) : null}
    </VStack>
  );

  if (!href) {
    return (
      <HStack gap={2} paddingX={2} paddingY={1.5}>
        {body}
      </HStack>
    );
  }

  return (
    <LangySpaAnchor
      href={href}
      display="flex"
      alignItems="center"
      gap={2}
      paddingX={2}
      paddingY={1.5}
      borderRadius="md"
      _hover={{ background: "bg.muted" }}
    >
      {body}
      <ArrowUpRight size={12} color="var(--chakra-colors-fg-subtle)" />
    </LangySpaAnchor>
  );
}
