import { preview } from "vite";

const server = await preview({ configFile: false, root: new URL("..", import.meta.url).pathname, appType: "mpa", preview: { port: 4173 } });
server.printUrls();
