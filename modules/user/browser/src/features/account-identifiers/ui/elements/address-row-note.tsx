import { Text } from "@chakra-ui/react";

import { lastUsedLabel } from "../../model/last-used.ts";

/** The one line under an address: a link just sent beats a demotion note beats last use. */
export function AddressRowNote({
  value,
  linkJustSent,
  demotesFirst,
  lastUsedAt,
}: {
  value: string;
  linkJustSent: boolean;
  demotesFirst: boolean;
  lastUsedAt: string | undefined;
}) {
  if (linkJustSent) {
    return (
      <Text fontSize="xs" color="fg.muted" data-testid="address-link-sent">
        Check your email: we sent a link to {value}. Open it in this browser to finish.
      </Text>
    );
  }
  if (demotesFirst) {
    return (
      <Text fontSize="xs" color="fg.muted">
        Removing this makes another confirmed address primary first.
      </Text>
    );
  }
  const used = lastUsedLabel({ isoTimestamp: lastUsedAt });
  if (!used) return null;
  return (
    <Text fontSize="xs" color="fg.muted" data-testid="address-last-used">
      {used}
    </Text>
  );
}
