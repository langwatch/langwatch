import type { ReactNode } from "react";

import { Banner, BannerAction } from "../components/states/banner.tsx";
import { SkeletonRows } from "../components/states/skeletons.tsx";

/** `bodyScroll="content"`: a bounded column; the editor inside owns its scroll. */
export const BOUNDED_BODY = {
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  minHeight: 0,
} as const;

/** Loading and error replace an overlay body; shared by Drawer and Dialog. */
export function OverlayBodyState({
  loading,
  error,
  children,
}: {
  loading?: boolean;
  error?: { title: string; description?: string; onRetry?: () => void };
  children?: ReactNode;
}) {
  if (loading) return <SkeletonRows rows={6} />;
  if (error) {
    return (
      <Banner
        status="error"
        title={error.title}
        action={error.onRetry && <BannerAction onClick={error.onRetry}>Try again</BannerAction>}
      >
        {error.description}
      </Banner>
    );
  }
  return <>{children}</>;
}
