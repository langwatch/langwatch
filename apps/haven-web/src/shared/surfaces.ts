import type { ConsoleLink, StatusState } from "@langwatch/design-system-internal";

import type { Surface, SurfaceStatus } from "./contract.ts";

const STATES: Record<SurfaceStatus, { state: StatusState; label?: string }> = {
  live: { state: "live" },
  starting: { state: "starting" },
  down: { state: "down" },
  "not-selected": { state: "unknown", label: "Not selected" },
};

export const surfaceState = ({ status }: { status: SurfaceStatus }) => STATES[status];

/** The surfaces a developer opens in a browser, by the name and menu the top bar gives them. */
const CONSOLES: Record<string, { label: string; group?: string }> = {
  app: { label: "App" },
  mail: { label: "Mail", group: "Sims" },
  idp: { label: "IdP", group: "Sims" },
  storage: { label: "Storage", group: "Sims" },
  voice: { label: "Voice", group: "Sims" },
  llm: { label: "LLM", group: "Sims" },
  analytics: { label: "Analytics", group: "Sims" },
  "design-system": { label: "Design system", group: "Tools" },
  "mail-room": { label: "Mail room", group: "Tools" },
  observability: { label: "Grafana", group: "Tools" },
};

export const consolesOf = ({ surfaces }: { surfaces: Surface[] }): ConsoleLink[] =>
  surfaces.flatMap((surface) => {
    const known = CONSOLES[surface.name];
    const answers = surface.status === "live" || surface.status === "starting";
    if (known === undefined || surface.url === "" || !answers) return [];
    return [{ ...known, href: surface.url }];
  });

/** A stack's own surfaces: selected, and not the machine-wide Grafana every stack shares. */
export const ownSurfaces = ({ surfaces }: { surfaces: Surface[] }) =>
  surfaces.filter(
    (surface) => surface.status !== "not-selected" && surface.name !== "observability",
  );
