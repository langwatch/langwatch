import { Menu } from "@langwatch/design-system/menu";
import { Flex, IconButton } from "@langwatch/design-system/primitives";
import { Monitor, Moon, Sun } from "lucide-react";
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
      positioning={{ placement: "bottom-end", gutter: 6, strategy: "fixed" }}
    >
      <Menu.Trigger asChild>
        <IconButton
          data-docs-theme=""
          variant="ghost"
          colorPalette="gray"
          aria-label="Colour theme"
          width="40px"
          minWidth="40px"
          height="40px"
          borderRadius="full"
          bg="transparent"
          color="fg"
          title="Choose light, dark, or system theme"
        >
          <Sun size={18} className="docs-light-only" aria-hidden="true" />
          <Moon size={18} className="docs-dark-only" aria-hidden="true" />
        </IconButton>
      </Menu.Trigger>
      <Menu.Content width="176px" outline="none" aria-label="Colour theme">
        <Menu.RadioItemGroup value={choice} onValueChange={({ value }) => select(value)}>
          {[
            { value: "system", label: "System", Icon: Monitor },
            { value: "light", label: "Light", Icon: Sun },
            { value: "dark", label: "Dark", Icon: Moon },
          ].map(({ value, label, Icon }) => (
            <Menu.RadioItem key={value} value={value} data-theme={value}>
              <Flex alignItems="center" gap="2">
                <Icon size={15} aria-hidden="true" />
                {label}
              </Flex>
            </Menu.RadioItem>
          ))}
        </Menu.RadioItemGroup>
      </Menu.Content>
    </Menu.Root>
  );
}
