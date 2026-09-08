import { defineFeature } from "@langwatch/runtime-composition";
import { UserApp } from "./app/user.app.ts";
import { userRepositories } from "./repositories/user-repositories.registry.ts";

export const userServer = defineFeature("user")
  .withRepositories(userRepositories)
  .withApp(UserApp)
  .build();
