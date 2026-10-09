import type { ReleaseFlagToken } from "@langwatch/module";

import { type UiHostServiceSource, useHostService } from "./capabilities.ts";
import { hostService } from "./declarations.ts";

/** The current scope's release flags: on, off, or undefined while not yet answered. */
export type UiFlags = Readonly<{ flag: (token: ReleaseFlagToken) => boolean | undefined }>;

/** Feature-flag's browser provides it (ARCHITECTURE.md §10.1). */
export const UiFlagsService = hostService<UiHostServiceSource<UiFlags>>("flags");

const UNANSWERED_UI_FLAGS: UiFlags = { flag: () => undefined };

/** The current scope's flags; outside a shell every flag reads not yet answered. */
export function useUiFlags(): UiFlags {
  return useHostService(UiFlagsService) ?? UNANSWERED_UI_FLAGS;
}
