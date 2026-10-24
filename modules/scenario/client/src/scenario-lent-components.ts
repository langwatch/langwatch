/**
 * Scenario's lent tokens as ready components: a borrower imports these and writes no wrapper
 * (§10.1). Its own entry point, so typing scenario's procedures never loads the host's lent code.
 */
import { lentComponent } from "@langwatch/browser-host/lent";

import { MediaPartToken, ParameterLineFieldToken, TalkToItPanelToken } from "./scenario-lent.ts";

export const MediaPart = lentComponent(MediaPartToken);
export const ParameterLineField = lentComponent(ParameterLineFieldToken);
export const TalkToItPanel = lentComponent(TalkToItPanelToken);
