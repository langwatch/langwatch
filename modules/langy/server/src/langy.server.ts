import { defineModule } from "@langwatch/runtime-composition";
import { LangyApp } from "./app/langy.app.ts";

export type { LangyInfrastructure } from "./app/langy.app.ts";

export const langyServer = defineModule("langy").withApp(LangyApp).build();
