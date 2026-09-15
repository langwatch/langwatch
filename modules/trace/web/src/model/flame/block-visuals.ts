/**
 * How one flame block is painted: fill strength, border, shadow and stacking.
 * The visual hierarchy is selected > focused > hovered > ancestor/child > rest.
 */

import { DEPTH_FADE_FLOOR, DEPTH_FADE_STEP, TINY_BLOCK_ALPHA_FACTOR } from "./constants.ts";

export interface BlockEmphasis {
  isAncestor: boolean;
  isDirectChild: boolean;
  isDimmed: boolean;
  isError: boolean;
  isFocused: boolean;
  isHovered: boolean;
  isSelected: boolean;
  isTiny: boolean;
}

/** How far a block fades purely for sitting deep in the tree. */
export function depthAlphaFor(depth: number): number {
  return Math.max(DEPTH_FADE_FLOOR, 1 - depth * DEPTH_FADE_STEP);
}

function darkFillAlpha(emphasis: BlockEmphasis, depthAlpha: number): number {
  if (emphasis.isSelected || emphasis.isHovered || emphasis.isFocused) return 1;
  if (emphasis.isAncestor) return Math.max(depthAlpha, 0.85);
  if (emphasis.isDirectChild) return Math.max(depthAlpha, 0.8);
  if (emphasis.isDimmed) return depthAlpha * 0.3;
  return emphasis.isTiny ? depthAlpha * TINY_BLOCK_ALPHA_FACTOR : depthAlpha;
}

/**
 * Light mode runs on a much stronger floor: alpha-tinted `.solid` tokens
 * against a white surface produce pale fills that white text disappears into.
 */
function lightFillAlphaPct(emphasis: BlockEmphasis): number {
  if (emphasis.isSelected || emphasis.isHovered || emphasis.isFocused) return 100;
  if (emphasis.isDimmed) return 55;
  if (emphasis.isAncestor || emphasis.isDirectChild) return 95;
  return emphasis.isTiny ? Math.round(85 * TINY_BLOCK_ALPHA_FACTOR) : 85;
}

function borderWidthFor(emphasis: BlockEmphasis): string {
  if (emphasis.isError) return "1.5px";
  if (emphasis.isSelected) return "2px";
  if (emphasis.isFocused) return "1.5px";
  if (emphasis.isAncestor || emphasis.isDirectChild) return "1px";
  return emphasis.isTiny ? "0" : "0.5px";
}

function borderColorFor(emphasis: BlockEmphasis): string {
  if (emphasis.isError) return "red.solid";
  if (emphasis.isSelected) return "fg";
  if (emphasis.isFocused || emphasis.isAncestor) return "fg.muted";
  return emphasis.isDirectChild ? "border.emphasized" : "border.muted";
}

function boxShadowFor(emphasis: BlockEmphasis): string | undefined {
  if (emphasis.isSelected) {
    return "0 0 0 2px var(--chakra-colors-bg-panel), 0 2px 8px rgba(0,0,0,0.18)";
  }
  return emphasis.isHovered ? "sm" : undefined;
}

function zIndexFor(emphasis: BlockEmphasis): number {
  if (emphasis.isSelected) return 3;
  return emphasis.isFocused || emphasis.isHovered ? 2 : 1;
}

/** Every painted property one block needs, from its emphasis and its depth. */
export function flameBlockVisuals({ depth, emphasis }: { depth: number; emphasis: BlockEmphasis }) {
  const depthAlpha = depthAlphaFor(depth);

  return {
    bgAlphaPct: Math.round(darkFillAlpha(emphasis, depthAlpha) * 100),
    borderColor: borderColorFor(emphasis),
    borderWidth: borderWidthFor(emphasis),
    boxShadow: boxShadowFor(emphasis),
    lightBgAlphaPct: lightFillAlphaPct(emphasis),
    zIndex: zIndexFor(emphasis),
  };
}
