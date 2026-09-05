/**
 * Whether a routed page opens at all.
 */

import type { ComponentType } from "react";
import { useUiCapabilities } from "@langwatch/ui-host/capabilities";

export type UiPageGuardFallbacks = {
  /** While the flags this page is behind have not answered. */
  loading: ComponentType;
  /** When a flag this page is behind is off. */
  notFound: ComponentType;
  /** When the viewer is missing the grant, named back to them. */
  forbidden: ComponentType<{ permission: string }>;
};

export type UiPageGuardInstall = {
  /** Every flag that must be on for the page to exist. */
  flags?: readonly string[];
  /** The grant the page needs once it exists. */
  permission?: string;
  fallbacks: UiPageGuardFallbacks;
};

/**
 * The guard's answer for one render, without any of the rendering.
 */
export type UiPageAccess =
  | { kind: "loading" }
  | { kind: "not-found" }
  | { kind: "forbidden"; permission: string }
  | { kind: "open" };

export function resolveUiPageAccess({
  flags = [],
  permission,
  featureFlag,
  hasPermission,
  isSettled,
}: {
  flags?: readonly string[];
  permission?: string;
  featureFlag: (flag: string) => boolean | undefined;
  hasPermission: (permission: string) => boolean;
  isSettled: () => boolean;
}): UiPageAccess {
  // Every flag is asked, never only up to the first unanswered one: asking is
  // what registers the read, and a short-circuit would fetch them one round
  // trip at a time.
  const answers = flags.map((flag) => featureFlag(flag));
  if (answers.some((answer) => answer === void 0)) return { kind: "loading" };
  if (answers.some((answer) => answer === false)) return { kind: "not-found" };

  if (permission !== void 0 && isSettled() && !hasPermission(permission)) {
    return { kind: "forbidden", permission };
  }

  return { kind: "open" };
}

/** Wraps a page in the flag and permission policy its route is behind. */
export function withUiPageGuard({ flags, permission, fallbacks }: UiPageGuardInstall) {
  return function guard<P extends object>(Page: ComponentType<P>): ComponentType<P> {
    const Guarded = (props: P) => {
      const { session } = useUiCapabilities();
      const access = resolveUiPageAccess({
        ...(flags ? { flags } : {}),
        ...(permission !== void 0 ? { permission } : {}),
        featureFlag: (flag) => session.featureFlag(flag),
        hasPermission: (needed) => session.hasPermission(needed),
        isSettled: () => session.isSettled(),
      });

      if (access.kind === "loading") return <fallbacks.loading />;
      if (access.kind === "not-found") return <fallbacks.notFound />;
      if (access.kind === "forbidden")
        return <fallbacks.forbidden permission={access.permission} />;
      return <Page {...props} />;
    };

    Guarded.displayName = `withUiPageGuard(${Page.displayName ?? Page.name ?? "Component"})`;
    return Guarded;
  };
}
