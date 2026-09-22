// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * One provider the administrator recognises: its own mark where the icon set
 * has one, its initials where it does not, and the name. A brand is
 * recognised in a fraction of the time its name is read, which is the whole
 * reason this is a grid and not a dropdown — and where no mark exists we draw
 * letters rather than invent a logo.
 */
import { Box, Text, chakra } from "@chakra-ui/react";
import { Check } from "lucide-react";
import type { IconType } from "react-icons";
import { FaMicrosoft } from "react-icons/fa6";
import { LuFileCode2, LuShieldQuestion } from "react-icons/lu";
import { SiAuth0, SiGoogle, SiKeycloak, SiOkta, SiOpenid } from "react-icons/si";

import type { IdentityProviderPreset } from "../../model/identity-providers.ts";

/** Marks by preset, so the metadata itself stays free of components. */
const MARKS: Record<string, IconType> = {
  okta: SiOkta,
  entra: FaMicrosoft,
  google: SiGoogle,
  keycloak: SiKeycloak,
  auth0: SiAuth0,
  oidc: SiOpenid,
  saml: LuFileCode2,
  other: LuShieldQuestion,
};

export function IdentityProviderTile({
  preset,
  selected,
  onPick,
}: {
  preset: IdentityProviderPreset;
  selected: boolean;
  onPick: () => void;
}) {
  const Mark = MARKS[preset.id];

  return (
    <chakra.button
      type="button"
      // Upstream's `role="radio"`: `jsx-a11y(prefer-tag-over-role)` errors on
      // a role that has its own tag, and nothing may suppress it, so the tile
      // says it is pressed instead. The group's own semantics arrive with the
      // picker that holds the tiles.
      aria-pressed={selected}
      onClick={onPick}
      // Set here because nothing above the tile carries a palette, and a bare
      // `colorPalette.*` falls through to the theme's default one.
      colorPalette="orange"
      display="flex"
      alignItems="center"
      gap={2.5}
      paddingX={3}
      paddingY={2.5}
      borderWidth="1px"
      borderColor={selected ? "colorPalette.solid" : "border.emphasized"}
      borderRadius="lg"
      background={selected ? "colorPalette.subtle" : "bg.panel"}
      cursor="pointer"
      textAlign="left"
      transition="all 0.15s ease"
      _hover={{ borderColor: selected ? "colorPalette.solid" : "border" }}
      data-testid={`identity-provider-${preset.id}`}
    >
      <Box
        width="7"
        height="7"
        borderRadius="md"
        background={selected ? "colorPalette.solid" : "bg.muted"}
        color={selected ? "colorPalette.contrast" : "fg.muted"}
        display="flex"
        alignItems="center"
        justifyContent="center"
        fontSize="xs"
        fontWeight="semibold"
        flexShrink={0}
        data-testid={`identity-provider-mark-${preset.id}`}
      >
        <TileMark mark={Mark} monogram={preset.monogram} selected={selected} />
      </Box>
      <Text fontSize="sm" fontWeight="medium" lineClamp={1}>
        {preset.name}
      </Text>
    </chakra.button>
  );
}

/** A tick once it is picked, the product's mark where there is one, letters otherwise. */
function TileMark({
  mark: Mark,
  monogram,
  selected,
}: {
  mark: IconType | undefined;
  monogram: string;
  selected: boolean;
}) {
  if (selected) return <Check size={14} aria-hidden="true" />;
  if (Mark) return <Mark size={15} aria-hidden="true" />;

  return <>{monogram}</>;
}
