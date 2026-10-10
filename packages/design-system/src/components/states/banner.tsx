import { Box, Button, type ButtonProps, chakra, HStack, Text } from "@chakra-ui/react";
import { AlertCircle, CheckCircle2, Info, TriangleAlert } from "lucide-react";
import { forwardRef, type ReactNode } from "react";

import { bannerGlass, bannerRim, type StatusHue } from "../../system/status-glass.ts";
import { CloseButton } from "../overlays/close-button.tsx";

export type BannerStatus = "info" | "warning" | "error" | "success";

const HUE: Record<BannerStatus, StatusHue> = {
  info: "blue",
  warning: "orange",
  error: "red",
  success: "green",
};

const GLYPH = { info: Info, warning: TriangleAlert, error: AlertCircle, success: CheckCircle2 };

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

/** The banner's one action: a small pill in the banner's rim colour, a link through `asChild`. */
export const BannerAction = forwardRef<HTMLButtonElement, ButtonProps>(
  function BannerAction(props, ref) {
    return (
      <Button
        ref={ref}
        size="xs"
        variant="outline"
        borderRadius="full"
        borderColor="var(--banner-rim)"
        bg={{ _light: "bg.surface/70", _dark: "whiteAlpha.100" }}
        color="fg"
        fontWeight="semibold"
        flexShrink={0}
        _hover={{ bg: { _light: "bg.surface", _dark: "whiteAlpha.200" } }}
        {...props}
      />
    );
  },
);

/** A status message across a page or a section, in the toasts' glass at a pale tint. */
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
      {...bannerGlass(hue)}
      css={{
        "--banner-rim": bannerRim(hue),
        ...(top
          ? {
              borderRadius: 0,
              borderBottomLeftRadius: PANEL_RADIUS,
              boxShadow: "inset 0 -1px 0 var(--banner-rim)",
              // Stacked top banners read as one band: only the last one curves.
              "&:has(+ [data-banner-placement=top])": { borderBottomLeftRadius: 0 },
            }
          : {
              borderRadius: "xl",
              borderWidth: "1px",
              borderColor: "var(--banner-rim)",
              boxShadow: {
                _light: "inset 0 1px 0 rgba(255, 255, 255, 0.7), 0 1px 2px rgba(2, 6, 23, 0.04)",
                _dark: "inset 0 1px 0 rgba(255, 255, 255, 0.06)",
              },
            }),
      }}
    >
      <Box
        color={{ _light: `${hue}.600`, _dark: `${hue}.300` }}
        display="flex"
        alignItems="center"
        height="5"
        flexShrink={0}
      >
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
