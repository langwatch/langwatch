import { createSystem, defaultConfig, mergeConfigs } from "@chakra-ui/react";
import { designSystemConfig } from "./config";

export type DesignSystemExtension = Parameters<typeof mergeConfigs>[number];

export function createDesignSystem(
  ...extensions: DesignSystemExtension[]
): ReturnType<typeof createSystem> {
  return createSystem(defaultConfig, mergeConfigs(designSystemConfig, ...extensions));
}

export const system = createDesignSystem();
