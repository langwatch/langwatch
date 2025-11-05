import React from "react";
import { useZoom } from "~/hooks/useZoom";
import { ZoomContext } from "./zoomContext";

interface ZoomRootProps {
  children: React.ReactNode;
}

/**
 * Root component that provides zoom context to its children.
 * Single Responsibility: Initialize and provide zoom state context.
 */
export function ZoomRoot({ children }: ZoomRootProps) {
  const zoom = useZoom();

  return <ZoomContext.Provider value={zoom}>{children}</ZoomContext.Provider>;
}

