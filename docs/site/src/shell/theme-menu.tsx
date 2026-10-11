import { Box, IconButton } from "@langwatch/design-system/primitives";
import { Monitor, Moon, Sun } from "lucide-react";

export function ThemeMenu() {
  return (
    <Box position="relative">
      <IconButton
        data-docs-theme=""
        variant="ghost"
        colorPalette="gray"
        aria-label="Colour theme"
        aria-haspopup="menu"
        aria-expanded={false}
        minWidth="44px"
        height="44px"
        color="fg.muted"
      >
        <Sun size={20} className="docs-light-only" aria-hidden="true" />
        <Moon size={20} className="docs-dark-only" aria-hidden="true" />
      </IconButton>
      <div className="docs-menu" role="menu" aria-label="Colour theme" hidden>
        <button type="button" role="menuitemradio" aria-checked="true" data-theme="system">
          <Monitor size={16} /> System
        </button>
        <button type="button" role="menuitemradio" aria-checked="false" data-theme="light">
          <Sun size={16} /> Light
        </button>
        <button type="button" role="menuitemradio" aria-checked="false" data-theme="dark">
          <Moon size={16} /> Dark
        </button>
      </div>
    </Box>
  );
}
