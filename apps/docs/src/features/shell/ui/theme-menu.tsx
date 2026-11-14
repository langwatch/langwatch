import { Menu } from "@langwatch/design-system/menu";
import { Box } from "@langwatch/design-system/primitives";
import { Check, Monitor, Moon, Sun } from "lucide-react";

const RAYS = [0, 45, 90, 135, 180, 225, 270, 315];
const CHOICES = [
  { value: "system", label: "System", Icon: Monitor },
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
] as const;

/**
 * The button shows the current theme (the sun takes a bite to become the moon) and opens System,
 * Light and Dark, drawn at build time into a template as the page actions are. The context menus
 * island shows it and ticks the stored choice, which the prerendered page cannot know.
 */
export function ThemeMenu() {
  return (
    <span className="docs-theme-menu">
      <button
        type="button"
        data-docs-theme-menu=""
        className="docs-theme-toggle"
        aria-label="Color theme"
        aria-haspopup="menu"
        aria-expanded="false"
        title="Choose light, dark or system theme"
      >
        <svg className="docs-theme-icon" viewBox="0 0 24 24" aria-hidden="true">
          <mask id="docs-moon-bite">
            <rect width="24" height="24" fill="white" />
            <circle className="docs-moon-bite" fill="black" />
          </mask>
          <circle
            className="docs-sun-core"
            cx="12"
            cy="12"
            fill="currentColor"
            mask="url(#docs-moon-bite)"
          />
          <g className="docs-sun-rays" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            {RAYS.map((angle) => (
              <line
                key={angle}
                x1="12"
                y1="2.5"
                x2="12"
                y2="4.5"
                transform={`rotate(${angle} 12 12)`}
              />
            ))}
          </g>
        </svg>
      </button>
      <template>
        <Menu.Root open>
          <Menu.Content
            portalled={false}
            className="docs-context-menu"
            width="180px"
            padding="1.5"
            aria-label="Color theme"
          >
            {CHOICES.map(({ value, label, Icon }) => (
              <Menu.Item
                key={value}
                value={value}
                role="menuitemradio"
                aria-checked="false"
                data-docs-theme-choice={value}
              >
                <span className="docs-menu-icon">
                  <Icon size={16} />
                </span>
                <Box flex="1">{label}</Box>
                <Check size={16} className="docs-theme-check" aria-hidden="true" />
              </Menu.Item>
            ))}
          </Menu.Content>
        </Menu.Root>
      </template>
    </span>
  );
}
