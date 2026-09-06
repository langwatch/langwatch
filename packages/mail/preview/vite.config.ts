import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { defineConfig, type Plugin, type ViteDevServer } from "vite";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "..");
const registryModule = resolve(packageRoot, "src/templates/index.ts");

/**
 * The studio renders every message in Node, through the same `@react-email`
 * call the product sends with.
 *
 * A browser bundle of the templates would be a second rendering path, and a
 * second rendering path is how a preview starts disagreeing with the mail that
 * actually arrives. `ssrLoadModule` runs the real modules in this process and
 * re-runs them the moment a template file changes, so the studio is live
 * without owning a copy of anything.
 */
const templateRenderer = (): Plugin => {
  const load = (server: ViteDevServer) =>
    server.ssrLoadModule(registryModule) as Promise<typeof import("../src/templates/index")>;

  return {
    name: "langwatch-mail-preview",
    configureServer(server) {
      server.middlewares.use("/__templates", (_request, response) => {
        void load(server)
          .then((registry) => {
            const body = registry.mailTemplates.map((template) => ({
              id: template.id,
              title: template.title,
              sentWhen: template.sentWhen,
              fixtures: template.fixtures,
              formSchema: registry.propsFormSchema(template),
            }));
            respondJson(response, 200, body);
          })
          .catch((error: unknown) => respondJson(response, 500, { error: describe(error) }));
      });

      server.middlewares.use("/__render", (request, response) => {
        void readJson(request)
          .then(async ({ id, props }) => {
            const registry = await load(server);
            const template = registry.mailTemplates.find((entry) => entry.id === id);
            if (!template) {
              respondJson(response, 404, { error: `No template is registered as "${id}".` });
              return;
            }
            respondJson(response, 200, await registry.renderMailTemplate(template, props));
          })
          .catch((error: unknown) => respondJson(response, 422, { error: describe(error) }));
      });

      // "Open in new tab": the rendered document on its own, so a browser shows
      // it the way a mail client would rather than inside the studio's chrome.
      server.middlewares.use("/__document", (request, response) => {
        const props = new URL(request.url ?? "", "http://studio").searchParams;
        void load(server)
          .then(async (registry) => {
            const template = registry.mailTemplates.find(
              (entry) => entry.id === props.get("id"),
            );
            if (!template) {
              response.statusCode = 404;
              response.end("No such template.");
              return;
            }
            const { html } = await registry.renderMailTemplate(
              template,
              JSON.parse(props.get("props") ?? "{}"),
            );
            response.setHeader("content-type", "text/html; charset=utf-8");
            response.end(html);
          })
          .catch((error: unknown) => {
            response.statusCode = 422;
            response.end(describe(error));
          });
      });
    },
  };
};

const respondJson = (
  response: { statusCode: number; setHeader: (k: string, v: string) => void; end: (b: string) => void },
  status: number,
  body: unknown,
) => {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
};

const readJson = async (request: AsyncIterable<Buffer>): Promise<{ id: string; props: unknown }> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as { id: string; props: unknown };
};

/** Zod's own report is the useful half of a rejected edit, so it is what shows. */
const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export default defineConfig({
  root: here,
  plugins: [react(), templateRenderer()],
  server: { port: 5566, fs: { allow: [packageRoot, resolve(packageRoot, "../..")] } },
});
