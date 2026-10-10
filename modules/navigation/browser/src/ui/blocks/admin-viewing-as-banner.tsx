import { Banner, BannerAction } from "@langwatch/design-system/banner";
import { nowInstant } from "@langwatch/time";
import { Eye, LogOut } from "lucide-react";
import { useState } from "react";

import { NavigationLink } from "../elements/navigation-link.tsx";

/** Admin viewing-as banner for personal workspaces (only where impersonation is real) */
const DISMISS_TTL_MS = 24 * 60 * 60 * 1000;
const STORAGE_KEY_PREFIX = "langwatch:admin-banner-dismissed:v1:";

function loadDismissed(workspaceLabel: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PREFIX + workspaceLabel);
    if (!raw) return false;
    const ts = Number(raw);
    if (!Number.isFinite(ts)) return false;
    return nowInstant().epochMilliseconds - ts < DISMISS_TTL_MS;
  } catch {
    return false;
  }
}

function persistDismissed(workspaceLabel: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      STORAGE_KEY_PREFIX + workspaceLabel,
      String(nowInstant().epochMilliseconds),
    );
  } catch {
    // storage may be full / disabled
  }
}

export function AdminViewingAsBanner({ workspaceLabel }: { workspaceLabel: string }) {
  // Full on first paint, one quiet line for 24h after a dismiss; never hidden
  // (the governance bar is "always visible signal, even if compressed").
  const [collapsed, setCollapsed] = useState(() => loadDismissed(workspaceLabel));
  const [labelFrom, setLabelFrom] = useState(workspaceLabel);
  if (labelFrom !== workspaceLabel) {
    setLabelFrom(workspaceLabel);
    setCollapsed(loadDismissed(workspaceLabel));
  }

  const handleDismiss = () => {
    persistDismissed(workspaceLabel);
    setCollapsed(true);
  };

  const exit = (
    <BannerAction asChild aria-label="Exit and return to governance bird's-eye">
      <NavigationLink href="/governance">
        <LogOut size={12} />
        Exit
      </NavigationLink>
    </BannerAction>
  );
  const auditLog = <NavigationLink href="/settings/audit-log">/settings/audit-log</NavigationLink>;

  if (collapsed) {
    return (
      <Banner status="info" placement="top" icon={<Eye size={14} />} action={exit}>
        Viewing {workspaceLabel} as admin. Each access is logged at {auditLog}.
      </Banner>
    );
  }

  return (
    <Banner
      status="info"
      placement="top"
      icon={<Eye size={16} />}
      title={`Viewing ${workspaceLabel}'s personal workspace as org admin. This is not your data.`}
      action={exit}
      onDismiss={handleDismiss}
    >
      Each access is logged at {auditLog}.
    </Banner>
  );
}
