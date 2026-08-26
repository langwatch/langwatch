import { Container } from "@chakra-ui/react";
import { type PropsWithChildren } from "react";
import { DashboardLayout } from "~/components/DashboardLayout";

/**
 * The shell chrome carries the Settings title, the back entry and the
 * regrouped settings menu (specs/navigation/settings-shell-v2.feature),
 * so this layout only frames the content.
 */
export default function SettingsLayout({ children }: PropsWithChildren) {
  return (
    <DashboardLayout>
      <Container
        maxWidth="1280px"
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
