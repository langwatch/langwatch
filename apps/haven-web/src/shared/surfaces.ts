import type { StatusState } from "@langwatch/design-system-internal";

import type { Surface, SurfaceStatus } from "./contract.ts";

const STATES: Record<SurfaceStatus, { state: StatusState; label?: string }> = {
  live: { state: "live" },
  starting: { state: "starting" },
  down: { state: "down" },
  "not-selected": { state: "unknown", label: "Not selected" },
};

export const surfaceState = ({ status }: { status: SurfaceStatus }) => STATES[status];

/** The surfaces a developer opens in a browser, by the name the top bar gives them. */
const CONSOLE_LABELS: Record<string, string> = {
  app: "App",
  mail: "Mail",
  idp: "IdP",
  storage: "Storage",
  voice: "Voice",
  llm: "LLM",
  analytics: "Analytics",
  "design-system": "Design system",
  "mail-room": "Mail room",
  observability: "Grafana",
};

export const consoleLabel = ({ name }: { name: string }) => CONSOLE_LABELS[name];

export const consolesOf = ({ surfaces }: { surfaces: Surface[] }) =>
  surfaces.flatMap((surface) => {
    const label = consoleLabel({ name: surface.name });
    const answers = surface.status === "live" || surface.status === "starting";
    if (label === undefined || surface.url === "" || !answers) return [];
    return [{ label, href: surface.url }];
  });

/** A stack's own surfaces: selected, and not the machine-wide Grafana every stack shares. */
export const ownSurfaces = ({ surfaces }: { surfaces: Surface[] }) =>
  surfaces.filter(
    (surface) => surface.status !== "not-selected" && surface.name !== "observability",
  );
