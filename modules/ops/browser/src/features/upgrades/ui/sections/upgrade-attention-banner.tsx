/**
 * The shell's self-hosted upgrade notice: every signed-in user is told to contact their
 * operator, and an ops:view holder also gets a link to Ops › Upgrades (Alex, 2026-10-11).
 * Spec: modules/ops/specs/upgrades.feature
 */
import { useUiHostServices } from "@langwatch/browser-host/capabilities";
import { Link } from "@langwatch/browser-host/link";
import { Alert, Button } from "@langwatch/design-system/primitives";

import { useUpgradeAttentionNotice } from "../../behavior/use-upgrade-attention-notice.ts";

export const UPGRADES_PATH = "/ops/upgrades";

const OPS_VIEW_PERMISSION = "ops:view";

export function UpgradeAttentionBanner() {
  const { session } = useUiHostServices();
  const show = useUpgradeAttentionNotice();
  if (!show) return null;
  const operator = session.hasPermission(OPS_VIEW_PERMISSION);

  return (
    <Alert.Root
      status="warning"
      size="sm"
      width="auto"
      as="output"
      data-testid="upgrade-attention-banner"
    >
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title lineClamp={1}>
          LangWatch's last update needs attention. Contact your LangWatch operator.
        </Alert.Title>
      </Alert.Content>
      {operator && (
        <Link href={UPGRADES_PATH}>
          <Button size="xs" variant="outline">
            Open Upgrades
          </Button>
        </Link>
      )}
    </Alert.Root>
  );
}
