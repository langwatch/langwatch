import {
  buildResourceHref,
  buildSurfaceHref,
  extractPrimaryId,
  extractResourceName,
  extractToolText,
  isProposalOutput,
  resolveCapability as resolvePackageCapability,
  resolveCapabilityProgress as resolvePackageCapabilityProgress,
  resolveCliCapability as resolvePackageCliCapability,
  summaryLines,
  SURFACE_BY_FEATURE,
  SURFACE_LABEL,
  SURFACE_PATH,
  withDecidedCard,
} from "../../../../model/langy-capability-registry.ts";
import type {
  CapabilityCardInput,
  CapabilityDescriptor,
  CapabilityProgress,
  CliCapability,
} from "../../../../model/langy-capability-registry.ts";
import { featureForCliCommand } from "../../../../model/shared/langy/feature-map.ts";

const featureMap = { featureForCliCommand };

export const resolveCliCapability = (rawName: string): CliCapability | null =>
  resolvePackageCliCapability(rawName, featureMap);

export const resolveCapability = (rawName: string): CapabilityDescriptor | null =>
  resolvePackageCapability(rawName, featureMap);

export const resolveCapabilityProgress = (rawName: string): CapabilityProgress | null =>
  resolvePackageCapabilityProgress(rawName, featureMap);

export {
  buildResourceHref,
  buildSurfaceHref,
  extractPrimaryId,
  extractResourceName,
  extractToolText,
  isProposalOutput,
  summaryLines,
  SURFACE_BY_FEATURE,
  SURFACE_LABEL,
  SURFACE_PATH,
  withDecidedCard,
};

export type { CapabilityCardInput, CapabilityDescriptor, CapabilityProgress, CliCapability };
