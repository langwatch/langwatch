import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { readRedirects } from "../docs-routing.mjs";

export function generateCloudFrontFunction({ redirects }) {
  const template = readFileSync(new URL("./viewer-request.js", import.meta.url), "utf8");
  const code = template
    .replace("const redirects = {};", `const redirects = ${JSON.stringify(redirects)};`)
    .replace("export function handler", "function handler");
  if (Buffer.byteLength(code) > 10_240) {
    throw new Error("CloudFront function exceeds 10 KB; reduce redirect data before publishing");
  }
  return code;
}

export async function writeCloudFrontFunction({ docsRoot, outDir }) {
  const code = generateCloudFrontFunction({ redirects: readRedirects({ docsRoot }) });
  const target = path.join(outDir, "_deployment");
  await mkdir(target, { recursive: true });
  await writeFile(path.join(target, "viewer-request.js"), code);
  await writeFile(
    path.join(target, "function-config.json"),
    JSON.stringify({
      Comment: "LangWatch docs routes and redirects",
      Runtime: "cloudfront-js-2.0",
    }),
  );
}
