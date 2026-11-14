/**
 * The one lock in place of an Enterprise feature: self-hosted leads to the License page, Cloud
 * to the plans, and a reader who may not act is told who can.
 * Spec: specs/licensing/enterprise-lock.feature
 */
import { AccessState } from "@langwatch/design-system/access-state";
import { Button, HStack, Text } from "@langwatch/design-system/primitives";
import { Lock } from "lucide-react";
import type { ReactNode } from "react";

import { useUiDeployment } from "./capabilities.ts";
import { Link } from "./link.tsx";

/** Where a self-hosted install activates or buys a license. */
export const LICENSE_SETTINGS_HREF = "/settings/license";

/** Where Cloud compares plans. */
export const PLANS_HREF = "/settings/plans";

export const ASK_ADMIN_TO_ACTIVATE = "Ask an organization admin to activate a license.";
export const ASK_ADMIN_TO_UPGRADE = "Ask an organization admin about upgrading your plan.";

export type EnterpriseLockProps = {
  /** The feature, as a title starts it: "Audit log", "Roles & access". */
  feature: string;
  /** One line on what the feature does for the reader. */
  description: string;
  /** The reader may manage the organization (`organization:manage`), so may activate a license. */
  canManage: boolean;
  /** Cloud only: the reader may open the plans page; defaults to `canManage`. */
  canSeePlans?: boolean;
  /** Shown after the lock's own buttons, such as a "Not now" in a popover. */
  extraActions?: ReactNode;
  compact?: boolean;
  /** Inside a card that already draws the surface: the lock draws no box of its own. */
  inset?: boolean;
  /** `line` is one quiet sentence on a page the feature only adds to, such as Users: the title
   * and the way forward or who to ask, without the description. */
  variant?: "card" | "line";
  "data-testid"?: string;
};

/** The words and buttons of the lock, decided by where it runs and who reads it. */
export function enterpriseLockCopy({
  feature,
  description,
  isSaaS,
  canManage,
  canSeePlans = canManage,
}: {
  feature: string;
  description: string;
  isSaaS: boolean;
  canManage: boolean;
  canSeePlans?: boolean;
}): {
  title: string;
  description: string;
  actions: "license" | "plans" | "none";
  askAdmin: string | null;
} {
  if (isSaaS) {
    const askAdmin = canSeePlans ? null : ASK_ADMIN_TO_UPGRADE;
    return {
      title: `${feature} is included in Enterprise`,
      description: askAdmin ? `${description} ${askAdmin}` : description,
      actions: canSeePlans ? "plans" : "none",
      askAdmin,
    };
  }
  const askAdmin = canManage ? null : ASK_ADMIN_TO_ACTIVATE;
  return {
    title: `${feature} is part of LangWatch Enterprise`,
    description: askAdmin ? `${description} ${askAdmin}` : description,
    actions: canManage ? "license" : "none",
    askAdmin,
  };
}

export function EnterpriseLock({
  feature,
  description,
  canManage,
  canSeePlans,
  extraActions,
  compact = false,
  inset = false,
  variant = "card",
  "data-testid": testId,
}: EnterpriseLockProps) {
  const { isSaaS } = useUiDeployment();
  const copy = enterpriseLockCopy({ feature, description, isSaaS, canManage, canSeePlans });
  if (variant === "line") return <EnterpriseLockLine copy={copy} testId={testId} />;
  const size = compact || inset ? "xs" : "sm";
  const own = lockActions({ actions: copy.actions, size });
  const actions =
    own || extraActions ? (
      <>
        {own}
        {extraActions}
      </>
    ) : undefined;
  const lock = (
    <AccessState
      kind="upgrade"
      compact={compact}
      inset={inset}
      title={copy.title}
      description={copy.description}
      actions={actions}
      data-testid={testId}
    />
  );
  return lock;
}

function lockActions({
  actions,
  size,
}: {
  actions: "license" | "plans" | "none";
  size: "xs" | "sm";
}): ReactNode {
  if (actions === "license") {
    return (
      <>
        <Button asChild size={size} colorPalette="orange">
          <Link href={LICENSE_SETTINGS_HREF}>Activate a license</Link>
        </Button>
        <Button asChild size={size} variant="outline">
          <Link href={LICENSE_SETTINGS_HREF}>Get a license</Link>
        </Button>
      </>
    );
  }
  if (actions === "none") return null;
  return (
    <Button asChild size={size} colorPalette="orange">
      <Link href={PLANS_HREF}>See plans</Link>
    </Button>
  );
}

const LINE_LINKS = {
  license: { href: LICENSE_SETTINGS_HREF, label: "Activate a license" },
  plans: { href: PLANS_HREF, label: "See plans" },
  none: null,
} as const;

function EnterpriseLockLine({
  copy,
  testId,
}: {
  copy: ReturnType<typeof enterpriseLockCopy>;
  testId?: string;
}) {
  const link = LINE_LINKS[copy.actions];
  return (
    <HStack gap={2} color="fg.muted" fontSize="sm" flexWrap="wrap" data-testid={testId}>
      <Lock size={14} aria-hidden />
      <Text>{copy.title}.</Text>
      {link ? (
        <Text asChild color="orange.fg">
          <Link unstyled href={link.href}>
            {link.label}
          </Link>
        </Text>
      ) : (
        copy.askAdmin && <Text>{copy.askAdmin}</Text>
      )}
    </HStack>
  );
}
