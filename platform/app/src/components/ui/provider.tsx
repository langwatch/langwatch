"use client";

import {
  DesignSystemProvider,
  type DesignSystemProviderProps,
} from "@langwatch/design-system/provider";
import { system } from "~/theme";

export function Provider(props: Omit<DesignSystemProviderProps, "system">) {
  return <DesignSystemProvider system={system} {...props} />;
}
