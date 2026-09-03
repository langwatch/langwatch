/** The prompt drawers, mounted in the host their package asks for; a drawer travels with itself, not the address. */

import { PromptListDrawer as PromptList } from "@langwatch/prompt-web/drawers";

import { withHost } from "../../../../ui/sections/ui-page";
import { PromptHost } from "./prompt-host";

export const PromptListDrawer = withHost(PromptHost, PromptList);
