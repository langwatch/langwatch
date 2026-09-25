import { Box } from "@chakra-ui/react";
import { KeyRound, Plug, ShieldCheck } from "lucide-react";
import type { PropsWithChildren } from "react";
import SettingsLayout from "~/components/SettingsLayout";
import { SectionNavigationFrame } from "~/components/ui/layouts/SectionNavigationLayout";

/** Shared settings navigation with a centered reading column. */
export function AuthenticationLayout({ children }: PropsWithChildren) {
  return (
    <SettingsLayout fullBleed>
      <SectionNavigationFrame
        sectionLabel="Authentication"
        navigationItems={[
          {
            label: "Overview",
            href: "/settings/authentication",
            icon: <ShieldCheck size={14} />,
          },
          {
            label: "Identity provider",
            href: "/settings/authentication/provider",
            includePath: "/settings/authentication/provider",
            icon: <KeyRound size={14} />,
          },
          {
            label: "Connectors",
            href: "/settings/authentication/connectors",
            includePath: "/settings/authentication/connectors",
            icon: <Plug size={14} />,
          },
        ]}
      >
        <Box maxWidth="1100px" width="full" marginInline="auto">
          {children}
        </Box>
      </SectionNavigationFrame>
    </SettingsLayout>
  );
}
