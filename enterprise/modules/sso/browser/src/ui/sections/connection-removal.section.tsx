// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The way out of a connection, which is two different acts wearing one
 * button: a draft is discarded on the spot, a live connection is scheduled
 * for teardown with its grace. Rendered only for `sso:manage`, where the
 * screen already decided that — it is the page's danger zone.
 */
import { Box, Button, Card, HStack, Text } from "@chakra-ui/react";
import type { SsoConnectionLifecycleState } from "@langwatch/identity-contract";
import { format } from "@langwatch/time";
import { TriangleAlert } from "lucide-react";
import { useState } from "react";

import {
  connectionRemovalActFor,
  connectionRemovalCopyFor,
  type ConnectionRemovalAct,
} from "../../model/connection-removal.ts";

export type ConnectionRemovalCommand = Exclude<ConnectionRemovalAct, { verb: "none" }>;

export function ConnectionRemovalSection({
  state,
  providerName,
  tearDownAfterMs,
  pending = false,
  settling = false,
  onRemove,
}: {
  state: SsoConnectionLifecycleState;
  /** What the customer calls their connection, not what we call it. */
  providerName: string;
  /** When a scheduled teardown finishes, if one is already scheduled. */
  tearDownAfterMs: number | null;
  pending?: boolean;
  /** Set between the removal being accepted and the read catching up. */
  settling?: boolean;
  onRemove: (command: ConnectionRemovalCommand) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const act = connectionRemovalActFor(state);

  // A tombstone has no way out left, and a section headed "danger zone" whose
  // only control cannot do anything is worse than no section.
  if (act.verb === "none") return null;

  const copy = connectionRemovalCopyFor({
    act,
    providerName,
    scheduledFor: tearDownAfterMs === null ? null : format(tearDownAfterMs, "d MMMM yyyy"),
  });

  return (
    <Card.Root borderColor="red.muted" background="red.subtle" data-testid="sso-remove">
      <Card.Body paddingX={4} paddingY={3.5} gap={3}>
        <HStack gap={2} align="center">
          <Box color="red.fg" display="flex" flexShrink={0} aria-hidden="true">
            <TriangleAlert size={14} />
          </Box>
          <Text fontSize="13.5px" fontWeight="semibold" color="red.fg">
            Danger zone
          </Text>
        </HStack>
        <HStack
          justify="space-between"
          align={{ base: "stretch", sm: "center" }}
          gap={3}
          flexDirection={{ base: "column", sm: "row" }}
        >
          <Text fontSize="13px" color="fg.muted" maxWidth="64ch">
            {copy.explanation}
          </Text>
          {confirming ? (
            <HStack gap={2} flexShrink={0}>
              <Button
                size="sm"
                colorPalette="red"
                variant="solid"
                loading={pending}
                data-testid="sso-remove-confirm"
                onClick={() => {
                  setConfirming(false);
                  onRemove(act);
                }}
              >
                {copy.confirm}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => setConfirming(false)}
              >
                Keep it
              </Button>
            </HStack>
          ) : (
            <Button
              size="sm"
              variant="outline"
              colorPalette="red"
              flexShrink={0}
              alignSelf={{ base: "start", sm: "center" }}
              loading={pending}
              // Shut while the removal settles, so a reader who cannot yet see
              // the new state cannot ask for it a second time.
              disabled={pending || settling}
              data-testid="sso-remove-open"
              onClick={() => setConfirming(true)}
            >
              {copy.open}
            </Button>
          )}
        </HStack>
        {settling && (
          <Text as="output" fontSize="xs" color="fg.muted" data-testid="sso-remove-settling">
            Removal accepted. Updating your connection status…
          </Text>
        )}
      </Card.Body>
    </Card.Root>
  );
}
