import { readPreviewOptions } from "../paths.ts";
import { startPreview } from "./preview-server.ts";

const server = await startPreview(readPreviewOptions());
server.printUrls();
