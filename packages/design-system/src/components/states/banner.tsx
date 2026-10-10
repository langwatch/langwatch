import { Box, Button, type ButtonProps, HStack, Text } from "@chakra-ui/react";
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
        bg="transparent"
        borderColor="border.muted"
        color="fg"
        boxShadow="none"
        _hover={{ bg: "bg.panel", borderColor: "border" }}
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
    <Box
      display="grid"
      gridTemplateColumns={onDismiss ? "auto minmax(0, 1fr) auto" : "auto minmax(0, 1fr)"}
      alignItems="start"
      data-testid={testId}
      data-banner-placement={placement}
      role={status === "error" ? "alert" : "status"}
      gap="3"
      width="full"
      paddingY={top ? "2.5" : "3"}
      paddingStart={top ? "6" : "4"}
      paddingEnd={top ? "4" : "3"}
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
      <Box
        color="colorPalette.fg"
        display="flex"
        alignItems="center"
        height={top ? "7" : "5"}
        aria-hidden="true"
      >
        {icon ?? <Glyph size={16} />}
      </Box>
      <HStack align="start" gap="3" rowGap="2" flexWrap="wrap" minWidth={0}>
        <Box
          flex="1 1 20rem"
          minWidth={0}
          paddingY={top ? "1" : "0"}
          lineHeight="5"
          overflowWrap="anywhere"
        >
          {title && (
            <Text
              as="span"
              display={top ? "inline" : "block"}
              fontWeight="medium"
              data-part="title"
            >
              {title}
            </Text>
          )}
          {title && children && top ? " " : null}
          {children && (
            <Text as="span" display={top ? "inline" : "block"} color="fg">
              {children}
            </Text>
          )}
        </Box>
        {action}
      </HStack>
      {onDismiss && (
        <CloseButton
          size="xs"
          aria-label="Dismiss"
          onClick={onDismiss}
          color="fg.muted"
          marginTop={top ? "0" : "-1"}
          _hover={{ color: "fg", bg: "bg.panel" }}
        />
      )}
    </Box>
  );
}
