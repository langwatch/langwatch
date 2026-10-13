import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { createServer, defineConfig, type Plugin, type ViteDevServer } from "vite";

import type * as indexModule from "../src/templates/index.ts";
import { buildGalleryEntries } from "./gallery-render.ts";
import { STATIC_STUDIO_META } from "./studio-endpoints.ts";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "..");
const registryModule = resolve(packageRoot, "src/templates/index.ts");

/**
 * The studio renders every message in Node, through the same `@react-email`
 * call the product sends with — a browser bundle would be a second path
 * that could disagree. `ssrLoadModule` re-runs the real modules on change.
 */
const load = (server: ViteDevServer) =>
  server.ssrLoadModule(registryModule) as Promise<typeof indexModule>;

const templateSummaries = (registry: typeof indexModule) =>
  registry.mailTemplates.map((template) => ({
    id: template.id,
    title: template.title,
    sentWhen: template.sentWhen,
    fixtures: template.fixtures,
    formSchema: registry.propsFormSchema(template),
  }));

const templateRenderer = (): Plugin => {
  return {
    name: "langwatch-mail-preview",
    configureServer(server) {
      server.middlewares.use("/__templates", (_request, response) => {
        void load(server)
          .then((registry) => respondJson(response, 200, templateSummaries(registry)))
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

      // The gallery: every fixture rendered in one round trip, so the grid view
      // never re-renders per card the way the single-template view does.
      server.middlewares.use("/__gallery", (request, response) => {
        const query = new URL(request.url ?? "", "http://studio").searchParams;
        const everyFixture = query.get("fixtures") === "all";
        void load(server)
          .then(async (registry) => {
            const entries = await buildGalleryEntries(
              registry.mailTemplates,
              registry.renderMailTemplate,
              { everyFixture },
            );
            respondJson(response, 200, entries);
          })
          .catch((error: unknown) => respondJson(response, 500, { error: describe(error) }));
      });

      // "Open in new tab": the rendered document on its own, so a browser shows
      // it the way a mail client would rather than inside the studio's chrome.
      server.middlewares.use("/__document", (request, response) => {
        const props = new URL(request.url ?? "", "http://studio").searchParams;
        void load(server)
          .then(async (registry) => {
            const template = registry.mailTemplates.find((entry) => entry.id === props.get("id"));
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

/**
 * `build:studio`: every fixture rendered once through the same call, written as
 * the files the built studio reads (studio-endpoints.ts). Haven serves the
 * result on the mail-room lane, so no dev server runs there.
 */
const staticRenders = (): Plugin => ({
  name: "langwatch-mail-static-renders",
  apply: "build",
  transformIndexHtml: (html) => html.replace("<head>", `<head>${STATIC_STUDIO_META}`),
  async generateBundle() {
    const server = await createServer({
      configFile: false,
      root: here,
      logLevel: "warn",
      appType: "custom",
      server: { middlewareMode: true, hmr: false },
    });
    const emit = (fileName: string, source: string) =>
      this.emitFile({ type: "asset", fileName, source });
    try {
      const registry = await load(server);
      const { mailTemplates, renderMailTemplate } = registry;
      emit("__templates.json", JSON.stringify(templateSummaries(registry)));
      for (const [fileName, everyFixture] of [
        ["__gallery.json", false],
        ["__gallery-all.json", true],
      ] as const) {
        const entries = await buildGalleryEntries(mailTemplates, renderMailTemplate, {
          everyFixture,
        });
        emit(fileName, JSON.stringify(entries));
      }
      for (const template of mailTemplates) {
        for (const [index, fixture] of template.fixtures.entries()) {
          const rendered = await renderMailTemplate(template, fixture.props);
          emit(`__render/${template.id}/${index}.json`, JSON.stringify(rendered));
          emit(`__document/${template.id}/${index}.html`, rendered.html);
        }
      }
    } finally {
      await server.close();
    }
  },
});

const respondJson = (
  response: {
    statusCode: number;
    setHeader: (k: string, v: string) => void;
    end: (b: string) => void;
  },
  status: number,
  body: unknown,
) => {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
};

const readJson = async (
  request: AsyncIterable<Buffer>,
): Promise<{ id: string; props: unknown }> => {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as { id: string; props: unknown };
};

/** Zod's own report is the useful half of a rejected edit, so it is what shows. */
const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export default defineConfig({
  root: here,
  plugins: [react(), templateRenderer(), staticRenders()],
  server: { port: 5566, fs: { allow: [packageRoot, resolve(packageRoot, "../..")] } },
});
