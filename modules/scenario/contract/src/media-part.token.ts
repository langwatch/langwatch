/** Scenario's media renderer, lent by token to the modules that show media parts (§10, §10.1). */

import { uiTokens } from "@langwatch/module";

import type { MediaPartProps } from "./media-part.types.ts";

export const MediaPartToken = uiTokens("scenario").component<MediaPartProps>("mediaPart");
