import { useColorMode } from "@langwatch/design-system/color-mode";
import { Menu } from "@langwatch/design-system/menu";
import { IconButton } from "@langwatch/design-system/primitives";
import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

type Choice = "system" | "light" | "dark";
const STORAGE_KEY = "theme";

function isChoice(value: string): value is Choice {
  return value === "system" || value === "light" || value === "dark";
}

function storedChoice(): Choice {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

/** One menu with System, Light and Dark; System is recorded as the stored preference. */
export function ThemeMenu() {
  const { colorMode, setColorMode } = useColorMode();
  const [choice, setChoice] = useState<Choice>("system");
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setChoice(storedChoice());
    setMounted(true);
  }, []);
  const apply = ({ next }: { next: Choice }) => {
    setChoice(next);
    if (next === "system") {
      setColorMode(window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
      window.localStorage.setItem(STORAGE_KEY, "system");
    } else {
      setColorMode(next);
    }
  };
  const Glyph = mounted && colorMode === "dark" ? Moon : Sun;
  return (
    <Menu.Root positioning={{ placement: "bottom-end" }}>
      <Menu.Trigger asChild>
        <IconButton variant="ghost" colorPalette="gray" aria-label="Colour theme" minWidth="44px" height="44px" color="fg.muted">
          <Glyph size={20} aria-hidden="true" />
        </IconButton>
      </Menu.Trigger>
      <Menu.Content minWidth="9rem">
        <Menu.RadioItemGroup value={choice} onValueChange={({ value }) => (isChoice(value) ? apply({ next: value }) : undefined)}>
          <Menu.RadioItem value="system">
            <Monitor size={16} aria-hidden="true" /> System
          </Menu.RadioItem>
          <Menu.RadioItem value="light">
            <Sun size={16} aria-hidden="true" /> Light
          </Menu.RadioItem>
          <Menu.RadioItem value="dark">
            <Moon size={16} aria-hidden="true" /> Dark
          </Menu.RadioItem>
        </Menu.RadioItemGroup>
      </Menu.Content>
    </Menu.Root>
  );
}
