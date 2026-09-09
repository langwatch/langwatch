import { defineFeature } from "@langwatch/runtime-composition";
import { LangyApp } from "./app/langy.app.ts";

export type { LangyInfrastructure } from "./app/langy.app.ts";

export const langyServer = defineFeature("langy").withApp(LangyApp).build();
