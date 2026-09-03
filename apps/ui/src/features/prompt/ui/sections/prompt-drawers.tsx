/**
 * The prompt drawers, mounted in the host their package asks for.
 *
 * A DRAWER IS NOT A PAGE: it opens over whatever page the reader is on, so the
 * host travels with the drawer rather than with the address. Wrapping happens
 * here, once, and the whole file is behind the registry's lazy import.
 */

import { PromptListDrawer as PromptList } from "@langwatch/prompt-web/drawers";

import { withPromptHost } from "./prompt-host-provider";

export const PromptListDrawer = withPromptHost(PromptList);
