import { defineServerModule } from "@langwatch/kernel";

import { InstantEvalApp } from "./app/instant-eval.app.ts";

export const instantEvalServer = defineServerModule("instant-eval").withApp(InstantEvalApp).build();
