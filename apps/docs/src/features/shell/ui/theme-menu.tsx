import { Menu } from "@langwatch/design-system/menu";
import { Box, IconButton } from "@langwatch/design-system/primitives";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useState } from "react";

function currentTheme() {
  try {
    return localStorage.getItem("theme") ?? "system";
  } catch {
    return "system";
  }
}
export function ThemeMenu({ initialOpen = false }: { initialOpen?: boolean }) {
  const [choice, setChoice] = useState(currentTheme);
  const [open, setOpen] = useState(initialOpen);
  const select = (value: string) => {
    setChoice(value);
    const dark =
      value === "dark" ||
      (value === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.classList.toggle("light", !dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
    try {
      localStorage.setItem("theme", value);
    } catch {
      /* Storage is optional. */
    }
  };
  return (
    <Menu.Root
      open={open}
      onOpenChange={({ open: next }) => {
        setOpen(next);
        if (next) setChoice(currentTheme());
      }}
      positioning={{ placement: "bottom-end", gutter: 6 }}
    >
      <Menu.Trigger asChild>
        <IconButton
          data-docs-theme=""
          variant="outline"
          colorPalette="gray"
          aria-label="Colour theme"
          width="40px"
          minWidth="40px"
          height="40px"
          borderRadius="lg"
          bg="docs.raised"
          color="fg.muted"
        >
          <Sun size={18} className="docs-light-only" aria-hidden="true" />
          <Moon size={18} className="docs-dark-only" aria-hidden="true" />
        </IconButton>
      </Menu.Trigger>
      <Menu.Content
        className="docs-context-menu"
        width="200px"
        padding="1.5"
        aria-label="Colour theme"
      >
        <Menu.RadioItemGroup value={choice} onValueChange={({ value }) => select(value)}>
          {[
            { value: "system", label: "System", Icon: Monitor },
            { value: "light", label: "Light", Icon: Sun },
            { value: "dark", label: "Dark", Icon: Moon },
          ].map(({ value, label, Icon }) => (
            <Menu.Item
              key={value}
              value={value}
              role="menuitemradio"
              aria-checked={choice === value}
              onSelect={() => select(value)}
              data-theme={value}
              className="docs-theme-choice"
              bg={choice === value ? "accent.subtle" : "transparent"}
              color={choice === value ? "accent.fg" : "fg"}
            >
              <Icon size={16} />
              <Box flex="1">{label}</Box>
              {choice === value ? <Check size={16} /> : null}
            </Menu.Item>
          ))}
        </Menu.RadioItemGroup>
      </Menu.Content>
    </Menu.Root>
  );
}
