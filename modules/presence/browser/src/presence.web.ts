/**
 * What a browser installs when it installs presence: no screen of its own. It
 * declares the `presence:` slices at install; the trace explorer reads and feeds them.
 */

import { defineBrowserModule } from "@langwatch/browser";

import "./behavior/presence-preferences-store.ts";
import "./behavior/presence-store.ts";
import "./behavior/section-tracker-store.ts";

export const presenceWeb = defineBrowserModule("presence");
