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
  /** Pages with their own navigation rail own scrolling and content width. */
  fullBleed?: boolean;
}>) {
  return (
    <DashboardLayout>
      <Container
        maxWidth={fullBleed ? "full" : "1280px"}
        padding={4}
        paddingBottom={fullBleed ? 4 : 16}
        height="full"
        minHeight={0}
        overflowY={fullBleed ? "hidden" : "auto"}
        flex={1}
      >
        {children}
      </Container>
    </DashboardLayout>
  );
}
