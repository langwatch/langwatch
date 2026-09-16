import { Box } from "@chakra-ui/react";
import { KeyRound, Plug, ShieldCheck } from "lucide-react";
import type { PropsWithChildren } from "react";
import SettingsLayout from "~/components/SettingsLayout";
import { SectionNavigationFrame } from "~/components/ui/layouts/SectionNavigationLayout";

/**
 * How anybody gets in, as three destinations rather than one long page.
 *
 * THE OVERVIEW WAS DOING TWO JOBS AND SWAPPING BETWEEN THEM. A live
 * connection is READ — is it on, is anybody going through it, which domains
 * does it cover — and setting one up is a five-step errand with its own
 * timeline. Both were the same address, and pressing "manage" replaced the
 * cards you were reading from with the journey. One navigation entry, two
 * screens, and no way to be looking at both.
 *
 * They are routes now, and the rail says so. Overview answers the questions;
 * each card on it carries an Edit that opens the full page for that half.
 * Nothing is hidden behind a mode, and a link to any of the three opens where
 * it was sent from.
 *
 * ONE PROVIDER, MANY CONNECTORS, which is why they are separate destinations
 * rather than two halves of one. An organization federates sign-in through a
 * single identity provider; it can be provisioned from more than one place,
 * and a page that assumed one of each would have to grow a list later
 * anyway.
 *
 * The rail is `SectionNavigationFrame` — the same one the event-sourcing
 * workspace uses — inside the settings chrome rather than instead of it: this
 * is a sub-navigation within one settings entry, the shape `/ai-gateway`
 * and `/ops/event-sourcing` already established.
 *
 * THE RAIL SITS ON THE EDGE AND THE READING COLUMN STAYS CENTRED. Inside
 * the ordinary settings frame both are inside one centred 1280px column, so
 * on a wide display the rail starts a couple of hundred pixels in from the
 * panel it belongs to and reads as floating rather than as the page's own
 * left-hand navigation. Taking the full width and centring the content
 * column instead puts the rail where the eye looks for it without moving
 * the words: the column it draws is the width the settings container gave
 * it before, minus the rail it always sat beside.
 *
 * Spec: specs/identity/org-access-cluster.feature
 */
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
