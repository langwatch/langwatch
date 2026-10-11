import { readPreviewOptions } from "./options.mjs";
import { startPreview } from "./preview-server.mjs";

const server = await startPreview(readPreviewOptions());
server.printUrls();
