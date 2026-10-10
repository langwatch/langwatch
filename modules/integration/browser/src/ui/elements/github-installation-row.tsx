/**
 * One GitHub installation, typed by the contract summary. Stateless:
 * mutations own the answers, the row is told.
 */

import { Link } from "@langwatch/browser-host/link";
import { Badge, Button, HStack, Text, VStack } from "@langwatch/design-system/primitives";
import { SettingItem } from "@langwatch/design-system/settings-card";
import type { GithubInstallationSummary } from "@langwatch/github-contract";

export type GithubInstallationRowProps = {
  installation: GithubInstallationSummary;
  /** Whether this row's disconnect is in flight. */
  disconnecting: boolean;
  /**
   * Whether GitHub has been opened to finish this uninstall. Disconnecting
   * drops the local record and hands back a deep link, but the row keeps
   * saying "Installed" until GitHub's webhook confirms — else it reads as inert.
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
    <SettingItem data-testid="github-installation-row">
      <HStack justify="space-between" gap={3} flexWrap="wrap">
        <VStack align="stretch" gap={0}>
          <HStack gap={2}>
            <Text fontSize="sm" fontWeight="medium">
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
              Finish uninstalling on GitHub: this updates once GitHub confirms.
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
            data-testid="github-disconnect"
            size="sm"
            variant="outline"
            loading={disconnecting}
            onClick={() => onDisconnect(installation.installationId)}
          >
            Disconnect
          </Button>
        </HStack>
      </HStack>
    </SettingItem>
  );
}
