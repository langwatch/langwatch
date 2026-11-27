import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { createServer, defineConfig, type Plugin, type ViteDevServer } from "vite";

import type * as indexModule from "../src/templates/index.ts";
import { buildDigestReview } from "./digest-review.ts";
import { STATIC_STUDIO_META } from "./studio-endpoints.ts";
import { serveAssetsLocally, STUDIO_ASSETS } from "./studio-shared.ts";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "..");
const registryModule = resolve(packageRoot, "src/templates/index.ts");
const appPublic = resolve(packageRoot, "../../apps/ui/public");

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

      server.middlewares.use("/__digest-review", (_request, response) => {
        void load(server)
          .then(async (registry) => {
            const sections = await buildDigestReview({
              templates: registry.mailTemplates,
              render: registry.renderMailTemplate,
            });
            respondJson(response, 200, sections);
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
 * The wordmarks the studio's previews point at (STUDIO_ASSETS), read from the app's own public
 * folder: served in dev, emitted into dist on build, so there is no copy to keep in step.
 */
const appAssets = (): Plugin => {
  const paths = Object.values(STUDIO_ASSETS);
  return {
    name: "langwatch-mail-app-assets",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = request.url?.split("?")[0] ?? "";
        if (!paths.includes(path)) {
          next();
          return;
        }
        void readFile(resolve(appPublic, `.${path}`))
          .then((body) => {
            response.setHeader(
              "content-type",
              path.endsWith(".svg") ? "image/svg+xml" : "image/png",
            );
            response.end(body);
          })
          .catch((error: unknown) => {
            response.statusCode = 404;
            response.end(describe(error));
          });
      });
    },
    async generateBundle() {
      for (const path of paths) {
        this.emitFile({
          type: "asset",
          fileName: path.slice(1),
          source: await readFile(resolve(appPublic, `.${path}`)),
        });
      }
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
      const review = await buildDigestReview({
        templates: mailTemplates,
        render: renderMailTemplate,
      });
      emit("__digest-review.json", JSON.stringify(review));
      for (const template of mailTemplates) {
        for (const [index, fixture] of template.fixtures.entries()) {
          const rendered = await renderMailTemplate(template, fixture.props);
          emit(`__render/${template.id}/${index}.json`, JSON.stringify(rendered));
          // Opened on its own under the hosted CSP, so it needs the studio's wordmarks too.
          emit(`__document/${template.id}/${index}.html`, serveAssetsLocally(rendered.html));
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
  plugins: [react(), templateRenderer(), appAssets(), staticRenders()],
  server: { port: 5566, fs: { allow: [packageRoot, resolve(packageRoot, "../..")] } },
});
