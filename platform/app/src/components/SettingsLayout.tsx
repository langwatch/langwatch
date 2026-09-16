import { Container } from "@chakra-ui/react";
import type { PropsWithChildren } from "react";
import { DashboardLayout } from "~/components/DashboardLayout";

/**
 * The shell chrome carries the Settings title, the back entry and the
 * regrouped settings menu (specs/navigation/settings-shell-v2.feature),
 * so this layout only frames the content.
 */
export default function SettingsLayout({
  children,
  fullBleed = false,
}: PropsWithChildren<{
  /**
   * Let the content span the window instead of sitting in the centred
   * 1280px column.
   *
   * For a page that draws its own navigation rail down the left. The centred
   * column pushes the rail inward by half the leftover width — a couple of
   * hundred pixels on a wide display — so the rail floats in open space
   * while the reader's eye expects it against the edge. Such a page takes
   * the full width here and centres its own CONTENT column inside its
   * frame, which puts the rail on the edge and leaves the reading column
   * where it was. Every other settings page wants the centred column and
   * says nothing.
   */
  fullBleed?: boolean;
}>) {
  return (
    <DashboardLayout>
      <Container
        maxWidth={fullBleed ? "full" : "1280px"}
        padding={4}
        paddingBottom={16}
        height="full"
        overflowY="auto"
        flex={1}
      >
        {children}
      </Container>
    </DashboardLayout>
  );
}
