import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import type { ControlSize } from "./button.tsx";
import { flag } from "./class-names.ts";
import { IconChevronDown, IconMore } from "./icons.tsx";

export type MenuItem = {
  label: string;
  onSelect: () => void;
  tone?: "default" | "danger";
  disabled?: boolean;
};

export type MenuProps = {
  /** The trigger's text, or its name when `iconOnly`. */
  label: string;
  items: MenuItem[];
  /** A square "more" trigger instead of a labelled one. */
  iconOnly?: boolean;
  /** Which trigger edge the list lines up with. */
  align?: "start" | "end";
  size?: ControlSize;
  defaultOpen?: boolean;
};

const menuSteps: Record<string, (index: number, count: number) => number> = {
  ArrowDown: (index, count) => (index + 1) % count,
  ArrowUp: (index, count) => (index - 1 + count) % count,
  Home: () => 0,
  End: (_index, count) => count - 1,
};

const enabledItems = ({ list }: { list: HTMLElement | null }) =>
  Array.from(list?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);

const moveWithin = ({ event, list }: { event: KeyboardEvent; list: HTMLElement | null }) => {
  const step = menuSteps[event.key];
  if (!step) return;
  event.preventDefault();
  const items = enabledItems({ list });
  const current = items.findIndex((item) => item === document.activeElement);
  items[step(Math.max(current, 0), items.length)]?.focus();
};

export const Menu = ({
  label,
  items,
  iconOnly = false,
  align = "start",
  size = "md",
  defaultOpen = false,
}: MenuProps) => {
  const [open, setOpen] = useState(defaultOpen);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  const close = ({ refocus }: { refocus: boolean }) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };
  const openAndFocus = () => {
    setOpen(true);
    requestAnimationFrame(() => enabledItems({ list: listRef.current })[0]?.focus());
  };

  return (
    <div className="ds-menu" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="ds-button"
        data-variant={iconOnly ? "ghost" : "secondary"}
        data-size={size}
        data-icon-only={flag({ on: iconOnly })}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={iconOnly ? label : undefined}
        title={iconOnly ? label : undefined}
        onClick={() => (open ? close({ refocus: false }) : openAndFocus())}
        onKeyDown={(event) => {
          if (event.key !== "ArrowDown") return;
          event.preventDefault();
          openAndFocus();
        }}
      >
        {iconOnly ? <IconMore /> : label}
        {!iconOnly && <IconChevronDown />}
      </button>
      {open && (
        <ul
          ref={listRef}
          id={listId}
          className="ds-menu-list"
          role="menu"
          aria-label={label}
          data-align={align}
          onKeyDown={(event) => {
            if (event.key === "Escape") close({ refocus: true });
            else if (event.key === "Tab") close({ refocus: false });
            else moveWithin({ event, list: listRef.current });
          }}
        >
          {items.map((item) => (
            <li key={item.label} role="none">
              <button
                type="button"
                role="menuitem"
                className="ds-menu-item"
                data-tone={item.tone ?? "default"}
                disabled={item.disabled}
                tabIndex={-1}
                onClick={() => {
                  close({ refocus: true });
                  item.onSelect();
                }}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
