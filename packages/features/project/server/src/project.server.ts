import { defineFeature } from "@langwatch/runtime-composition";
import { ProjectApp } from "./app/project.app.ts";

export const projectServer = defineFeature("project").withApp(ProjectApp).build();
