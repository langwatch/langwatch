"use client";

import {
  DesignSystemProvider,
  type DesignSystemProviderProps,
} from "@langwatch/design-system/provider";
import { uiDesignSystem } from "@langwatch/ui/design-system";

export function Provider(props: Omit<DesignSystemProviderProps, "system">) {
  return <DesignSystemProvider system={uiDesignSystem} {...props} />;
}
