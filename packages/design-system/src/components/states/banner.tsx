import { Box, Button, type ButtonProps, chakra, HStack, Text } from "@chakra-ui/react";
import { AlertCircle, CheckCircle2, Info, TriangleAlert } from "lucide-react";
import { forwardRef, type ReactNode } from "react";

import { statusMesh } from "../../system/alert.recipe.ts";
import { CloseButton } from "../overlays/close-button.tsx";

export type BannerStatus = "info" | "warning" | "error" | "success";

const HUE: Record<BannerStatus, "blue" | "orange" | "red" | "green"> = {
  info: "blue",
  warning: "orange",
  error: "red",
  success: "green",
};

const GLYPH = { info: Info, warning: TriangleAlert, error: AlertCircle, success: CheckCircle2 };

/** The quietest of the status meshes: a banner sits across content without shouting. */
const BANNER_MESH = statusMesh("banner");

/** The panel's own corner radius, so a top banner's one rounded corner continues it. */
const PANEL_RADIUS = "xl";

export type BannerProps = {
  status?: BannerStatus;
  /**
   * `top` sits flush in the top of the content panel, square on the top and right, with only
   * the bottom-left corner rounded; `inline` is a rounded card inside content.
   */
  placement?: "top" | "inline";
  title?: ReactNode;
  /** The sentence under or beside the title. */
  children?: ReactNode;
  /** Replaces the status glyph. */
  icon?: ReactNode;
  /** The one action: a `BannerAction`. */
  action?: ReactNode;
  /** Shows a dismiss button. */
  onDismiss?: () => void;
  "data-testid"?: string;
};

/** The banner's one action: a small outline button, a link through `asChild`. */
export const BannerAction = forwardRef<HTMLButtonElement, ButtonProps>(
  function BannerAction(props, ref) {
    return (
      <Button
        ref={ref}
        size="xs"
        variant="outline"
        colorPalette="gray"
        bg="bg.panel"
        flexShrink={0}
        {...props}
      />
    );
  },
);

/** A status message across a page or a section: a light status tint, a hairline, an icon. */
export function Banner({
  status = "info",
  placement = "inline",
  title,
  children,
  icon,
  action,
  onDismiss,
  "data-testid": testId,
}: BannerProps) {
  const hue = HUE[status];
  const Glyph = GLYPH[status];
  const top = placement === "top";
  return (
    <HStack
      data-testid={testId}
      data-banner-placement={placement}
      role={status === "error" ? "alert" : "status"}
      align="flex-start"
      gap="2.5"
      width="full"
      paddingY="2.5"
      paddingStart="4"
      paddingEnd="3"
      textStyle="sm"
      colorPalette={hue}
      color="fg"
      bg={BANNER_MESH.bg}
      backgroundImage={BANNER_MESH.backgroundImage}
      css={
        top
          ? {
              borderRadius: 0,
              borderBottomLeftRadius: PANEL_RADIUS,
              borderBottomWidth: "1px",
              borderColor: BANNER_MESH.borderColor,
              // Stacked top banners read as one band: only the last one curves.
              "&:has(+ [data-banner-placement=top])": { borderBottomLeftRadius: 0 },
            }
          : { borderRadius: "lg", borderWidth: "1px", borderColor: BANNER_MESH.borderColor }
      }
    >
      <Box color="colorPalette.fg" display="flex" alignItems="center" height="5" flexShrink={0}>
        {icon ?? <Glyph size={16} aria-hidden="true" />}
      </Box>
      <chakra.div
        flex="1"
        minWidth={0}
        display="flex"
        flexDirection={top ? "row" : "column"}
        flexWrap="wrap"
        columnGap="1.5"
        rowGap="0.5"
        alignItems={top ? "baseline" : "stretch"}
      >
        {title && (
          <Text as="span" fontWeight="semibold" data-part="title">
            {title}
          </Text>
        )}
        {title && children ? " " : null}
        {children && (
          <Text as="span" color="fg.muted">
            {children}
          </Text>
        )}
      </chakra.div>
      {action}
      {onDismiss && (
        <CloseButton size="2xs" aria-label="Dismiss" onClick={onDismiss} flexShrink={0} />
      )}
    </HStack>
  );
}
