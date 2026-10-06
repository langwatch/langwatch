/** The inline command palette project lends by token to a landing hero (§10, §10.1). */

import { uiTokens } from "@langwatch/module";

/** What a landing hero hands project's lent inline command palette. */
export type HeroAskFieldProps = { placeholder: string };

export const HeroAskFieldToken = uiTokens("project").component<HeroAskFieldProps>("heroAskField");
