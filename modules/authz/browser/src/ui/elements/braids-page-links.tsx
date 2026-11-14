// The quiet line under a Braids page's description: the guide and, for whoever may open it, the
// organisation's view of every braid. Spec: modules/authz/specs/braids-screen.feature

import { Link } from "@langwatch/browser-host/link";
import { HStack, Text } from "@langwatch/design-system/primitives";
import { ExternalLink } from "lucide-react";

import { BRAIDS_GUIDE_HREF } from "../../model/braids/braids.ts";

const ORGANIZATION_BRAIDS_HREF = "/settings/organization-braids";

export function BraidsPageLinks({
  organization,
}: {
  /** The organisation's Braids view; absent for whoever cannot open it, or on that view. */
  organization?: { name: string | undefined } | undefined;
}) {
  return (
    <HStack as="span" gap={2} marginTop={1} textStyle="sm" data-testid="braids-page-links">
      <Link
        href={BRAIDS_GUIDE_HREF}
        isExternal
        color="fg.muted"
        _hover={{ color: "fg" }}
        display="inline-flex"
        alignItems="center"
        gap={1}
      >
        How braids work
        <ExternalLink size={12} aria-hidden />
      </Link>
      {organization ? (
        <>
          <Text as="span" color="fg.subtle" aria-hidden>
            ·
          </Text>
          <Link
            href={ORGANIZATION_BRAIDS_HREF}
            color="fg.muted"
            _hover={{ color: "fg" }}
            data-testid="braids-organization-link"
          >
            {organization.name
              ? `All braids in ${organization.name}`
              : "All braids in your organisation"}
          </Link>
        </>
      ) : null}
    </HStack>
  );
}
