import type { ReactNode } from "react";

type SvgProps = { children: ReactNode; label?: string; className?: string };

const Svg = ({ children, label, className = "ds-icon" }: SvgProps) => (
  <svg
    className={className}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    role={label ? "img" : undefined}
    aria-label={label}
    aria-hidden={label ? undefined : true}
    focusable="false"
  >
    {children}
  </svg>
);

export type IconProps = { label?: string };

export const IconCopy = ({ label }: IconProps) => (
  <Svg label={label}>
    <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
    <path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
  </Svg>
);

export const IconCheck = ({ label }: IconProps) => (
  <Svg label={label}>
    <path d="M3 8.5l3.2 3L13 4.5" />
  </Svg>
);

export const IconChevronDown = ({ label }: IconProps) => (
  <Svg label={label}>
    <path d="M4 6l4 4 4-4" />
  </Svg>
);

export const IconClose = ({ label }: IconProps) => (
  <Svg label={label}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </Svg>
);

export const IconArrowUpRight = ({ label }: IconProps) => (
  <Svg label={label}>
    <path d="M5 11l6-6M6 5h5v5" />
  </Svg>
);

export const IconMore = ({ label }: IconProps) => (
  <Svg label={label}>
    <circle cx="3.5" cy="8" r="0.75" fill="currentColor" />
    <circle cx="8" cy="8" r="0.75" fill="currentColor" />
    <circle cx="12.5" cy="8" r="0.75" fill="currentColor" />
  </Svg>
);

export const IconSun = ({ label }: IconProps) => (
  <Svg label={label}>
    <circle cx="8" cy="8" r="2.75" />
    <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1" />
  </Svg>
);

export const IconMoon = ({ label }: IconProps) => (
  <Svg label={label}>
    <path d="M13.5 9.6A5.75 5.75 0 0 1 6.4 2.5a5.75 5.75 0 1 0 7.1 7.1z" />
  </Svg>
);

export const IconMonitor = ({ label }: IconProps) => (
  <Svg label={label}>
    <rect x="2" y="2.75" width="12" height="8.5" rx="1.5" />
    <path d="M5.5 14h5M8 11.25V14" />
  </Svg>
);

export const IconRefresh = ({ label }: IconProps) => (
  <Svg label={label}>
    <path d="M13 8a5 5 0 1 1-1.5-3.55M13 2.5v2.5h-2.5" />
  </Svg>
);

export const Spinner = () => (
  <Svg className="ds-spinner">
    <circle cx="8" cy="8" r="6" opacity="0.25" />
    <path d="M14 8a6 6 0 0 0-6-6" />
  </Svg>
);
