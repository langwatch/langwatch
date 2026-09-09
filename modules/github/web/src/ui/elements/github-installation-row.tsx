/**
 * One GitHub account the organization's installation reaches.
 *
 * Split out of the page body it was declared in, and typed by
 * `GithubInstallationSummary` rather than by the seven-field restatement the
 * page carried beside it — the contract is the producer, and a field the server
 * adds should not be invisible to the row that renders it.
 *
 * THE ROW HOLDS NO STATE ANY MORE. `platform/app` kept the "finish on GitHub"
 * hint in a `useState` inside the row and set it from the mutation's
 * `onSuccess`, which meant the row and the mutation both had to be reasoned
 * about to know when the hint appears. The screen owns the mutation, so it owns
 * the answer; the row is told.
 */

import { Badge, Box, Button, HStack, Link, Text, VStack } from "@chakra-ui/react";
import type { GithubInstallationSummary } from "@langwatch/github-contract";

export type GithubInstallationRowProps = {
  installation: GithubInstallationSummary;
  /** Whether this row's disconnect is in flight. */
  disconnecting: boolean;
  /**
   * Whether GitHub has been opened to finish this uninstall.
   *
   * Disconnecting drops the local record and hands back a deep link; the row
   * keeps saying "Installed" until GitHub's webhook confirms, which without a
   * hint reads as the button doing nothing.
   */
  uninstallStarted: boolean;
  onDisconnect: (installationId: string) => void;
};

/** How many repositories a "selected" install covers, spelled for a reader. */
export function repositorySummary(installation: GithubInstallationSummary): string {
  if (installation.repositorySelection === "all") return "All repositories";
  const count = installation.repositoryCount ?? 0;
  return `${count} selected ${count === 1 ? "repository" : "repositories"}`;
}

export function GithubInstallationRow({
  installation,
  disconnecting,
  uninstallStarted,
  onDisconnect,
}: GithubInstallationRowProps) {
  return (
    <Box borderWidth="1px" borderColor="border.muted" borderRadius="md" padding={3}>
      <HStack justify="space-between" gap={3}>
        <VStack align="stretch" gap={0}>
          <HStack gap={2}>
            <Text fontSize="sm" fontWeight="600">
              @{installation.accountLogin}
            </Text>
            {installation.suspended ? (
              <Badge colorPalette="orange" variant="subtle">
                Suspended
              </Badge>
            ) : null}
          </HStack>
          <Text fontSize="xs" color="fg.muted">
            {repositorySummary(installation)}
          </Text>
          {uninstallStarted ? (
            <Text fontSize="xs" color="fg.muted">
              Finish uninstalling on GitHub — this updates once GitHub confirms.
            </Text>
          ) : null}
        </VStack>
        <HStack gap={2}>
          <Link
            href={installation.uninstallUrl}
            target="_blank"
            rel="noopener noreferrer"
            fontSize="sm"
          >
            Configure
          </Link>
          <Button
            size="sm"
            variant="outline"
            loading={disconnecting}
            onClick={() => onDisconnect(installation.installationId)}
          >
            Disconnect
          </Button>
        </HStack>
      </HStack>
    </Box>
  );
}
