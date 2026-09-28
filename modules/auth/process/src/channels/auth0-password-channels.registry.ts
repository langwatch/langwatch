import { HttpAuth0PasswordChannel } from "./http/http.auth0-password.channel.ts";
import { MemoryAuth0PasswordChannel } from "./memory/memory.auth0-password.channel.ts";

export const auth0PasswordChannels = {
  http: HttpAuth0PasswordChannel,
  memory: MemoryAuth0PasswordChannel,
};
