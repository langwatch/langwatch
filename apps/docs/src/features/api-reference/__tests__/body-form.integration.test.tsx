// @vitest-environment jsdom
import { DesignSystemTestProvider } from "@langwatch/design-system/testing";
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { bodyFormOf, type FormField } from "../model/body-form.ts";
import { operationSchema } from "../model/operation-schema.ts";
import { EndpointStateProvider } from "../ui/endpoint-state.tsx";
import { Playground } from "../ui/playground.tsx";

/* Holds the typed fields back until a test lets them load, to type into the form meanwhile. */
const typedFields = vi.hoisted(() => {
  let open = () => {};
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { opened, open: () => open() };
});
vi.mock("../browser/request-values.ts", async (importOriginal) => {
  await typedFields.opened;
  return importOriginal();
});

vi.hoisted(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.getAnimations = () => [];
  Object.defineProperty(window, "matchMedia", {
    value: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
  });
});

const operation = operationSchema.parse({
  method: "POST",
  path: "/api/things/search",
  origin: "https://app.langwatch.ai",
  summary: "Search things",
  description: "",
  deprecated: false,
  schemes: [{ id: "api_key", type: "apiKey", in: "header", name: "X-Auth-Token" }],
  parameters: [
    {
      in: "query",
      name: "since",
      required: false,
      deprecated: false,
      description: "",
      schema: { type: "string", format: "date-time" },
    },
    {
      in: "query",
      name: "order",
      required: false,
      deprecated: false,
      description: "",
      schema: { type: "string", enum: ["asc", "desc"] },
    },
    {
      in: "query",
      name: "archived",
      required: false,
      deprecated: false,
      description: "",
      schema: { type: "boolean" },
    },
    {
      in: "query",
      name: "limit",
      required: false,
      deprecated: false,
      description: "",
      schema: { type: "integer", minimum: 1, maximum: 100 },
    },
  ],
  body: {
    required: true,
    description: "",
    contents: [
      {
        type: "application/json",
        schema: {
          type: "object",
          required: ["name", "startDate"],
          properties: {
            name: { type: "string", description: "What to call it." },
            startDate: { type: ["number", "string"] },
            expiresAt: { type: "string", format: "date-time" },
            day: { type: "string", format: "date" },
            createdAt: { type: "number", description: "Unix epoch in milliseconds." },
            updatedAt: { type: "number" },
            format: { type: "string", enum: ["digest", "json"] },
            includeSpans: { type: "boolean" },
            pageSize: { type: "integer", minimum: 1, maximum: 1000 },
            tags: { type: "array", items: { type: "string" } },
            window: {
              type: "object",
              properties: { days: { type: "integer" }, label: { type: "string" } },
            },
            filters: {
              type: "object",
              properties: {
                "topics.topics": { anyOf: [{ type: "array" }, { type: "object" }] },
              },
              additionalProperties: true,
            },
            metadata: { type: "object", additionalProperties: true },
            scrollId: { type: ["string", "null"] },
          },
        },
      },
    ],
  },
  responses: [],
});

document.body.innerHTML = `${renderToStaticMarkup(
  <DesignSystemTestProvider>
    <button type="button" id="try-it-button" aria-expanded="false">
      Try it
    </button>
    <EndpointStateProvider operation={operation}>
      <Playground operation={operation} slug="api-reference/things/search" />
    </EndpointStateProvider>
  </DesignSystemTestProvider>,
)}<script type="application/json" id="docs-page-data">${JSON.stringify({ operation })}</script>`;
await import("../browser/playground.tsx");

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const control = (key: string) => byId<HTMLInputElement>(`pg-body-${key}`);
const bodyText = () => byId<HTMLTextAreaElement>("pg-body").value;
const body = () => JSON.parse(bodyText()) as Record<string, unknown>;
const example = (id: string) =>
  document.querySelector<HTMLElement>(`[data-docs-example="${id}"] .docs-code-region`)?.dataset
    .code ?? "";

/* The island loads its typed fields after the first click; each step waits for that work. */
async function actThenSettle(step: () => void) {
  await act(async () => {
    step();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
async function type({
  element,
  value,
}: {
  element: HTMLInputElement | HTMLTextAreaElement;
  value: string;
}) {
  await actThenSettle(() => {
    element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function choose({ element, value }: { element: HTMLSelectElement; value: string }) {
  await actThenSettle(() => {
    element.value = value;
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
async function check({ element }: { element: HTMLInputElement }) {
  await actThenSettle(() => element.click());
}
async function press({ selector }: { selector: string }) {
  await actThenSettle(() => document.querySelector<HTMLElement>(selector)?.click());
}
const modeButton = (mode: string) => `[data-body-mode-button="${mode}"]`;
const panel = (mode: string) => document.querySelector<HTMLElement>(`[data-body-panel="${mode}"]`);
const kindOf = (fields: FormField[], name: string) =>
  fields.find((field) => field.name === name)?.kind;

beforeAll(async () => {
  await act(async () => document.getElementById("try-it-button")?.click());
});

describe("while the typed fields load", () => {
  /** @scenario "Keep what the reader typed while the typed fields load" */
  it("keeps a body field and a parameter typed before they arrive", async () => {
    const before = bodyText();
    await type({ element: control("name"), value: "early" });
    await type({ element: byId("pg-query-limit"), value: "7" });
    expect(control("name").value).toBe("early");
    expect(bodyText()).toBe(before);
    await actThenSettle(() => typedFields.open());
    await actThenSettle(() => {});
    expect(body().name).toBe("early");
    expect(example("curl")).toContain("early");
    expect(example("curl")).toContain("limit=7");
  });
});

describe("given a body whose schema is an object", () => {
  /** @scenario "Fill a request body in a form built from its schema" */
  it("draws each field as the control its schema asks for", () => {
    expect(document.querySelector('[data-body-mode="form"]')).not.toBeNull();
    expect(control("expiresAt").type).toBe("datetime-local");
    expect(control("day").type).toBe("date");
    expect(control("createdAt").type).toBe("datetime-local");
    expect(control("format").tagName).toBe("SELECT");
    expect(control("includeSpans").getAttribute("role")).toBe("radiogroup");
    expect(control("pageSize")).toMatchObject({ type: "number", min: "1", max: "1000" });
    expect(document.querySelector('[data-body-list="tags"] [data-body-add]')).not.toBeNull();
    expect(control("window").tagName).toBe("FIELDSET");
    expect(control("filters").tagName).toBe("TEXTAREA");
    expect(control("metadata").tagName).toBe("TEXTAREA");
    expect(document.querySelector('label[for="pg-body-name"]')?.textContent).toContain("Required");
    expect(byId("pg-body-name-hint").textContent).toContain("What to call it.");
  });

  /** @scenario "Fill a request body in a form built from its schema" */
  it("keeps a field with no date format a text field, whatever its name", () => {
    const fields = bodyFormOf({ operation })?.fields ?? [];
    expect(kindOf(fields, "startDate")).toBe("text");
    expect(kindOf(fields, "updatedAt")).toBe("number");
    expect(kindOf(fields, "scrollId")).toBe("text");
    expect(control("startDate").type).toBe("text");
  });

  /** @scenario "Fill a request body in a form built from its schema" */
  it("sends dates in the schema's format, in UTC, and leaves empty fields out", async () => {
    await type({ element: control("name"), value: "refunds" });
    await type({ element: control("startDate"), value: "1700000000000" });
    await type({ element: control("expiresAt"), value: "2026-03-01T09:30" });
    await type({ element: control("day"), value: "2026-03-02" });
    await type({ element: control("createdAt"), value: "2026-03-01T00:00:01" });
    await choose({ element: byId<HTMLSelectElement>("pg-body-format"), value: "json" });
    await check({
      element: document.querySelector<HTMLInputElement>(
        'input[name="pg-body-includeSpans"][value="false"]',
      )!,
    });
    await type({ element: control("pageSize"), value: "50" });
    await type({ element: control("window--days"), value: "7" });
    expect(body()).toEqual({
      name: "refunds",
      startDate: 1_700_000_000_000,
      expiresAt: "2026-03-01T09:30:00Z",
      day: "2026-03-02",
      createdAt: Date.UTC(2026, 2, 1, 0, 0, 1),
      format: "json",
      includeSpans: false,
      pageSize: 50,
      window: { days: 7 },
    });
  });

  /** @scenario "Fill a request body in a form built from its schema" */
  it("adds and removes rows of a list", async () => {
    await press({ selector: '[data-body-list="tags"] [data-body-add]' });
    await press({ selector: '[data-body-list="tags"] [data-body-add]' });
    const rows = () => [
      ...document.querySelectorAll<HTMLInputElement>(
        '[data-body-list="tags"] [data-body-rows] input',
      ),
    ];
    await type({ element: rows()[0]!, value: "a" });
    await type({ element: rows()[1]!, value: "b" });
    expect(rows().map((row) => row.getAttribute("aria-label"))).toEqual([
      "tags item 1",
      "tags item 2",
    ]);
    expect(body().tags).toEqual(["a", "b"]);
    await press({ selector: '[data-body-list="tags"] [aria-label="Remove tags item 1"]' });
    expect(body().tags).toEqual(["b"]);
    expect(rows()[0]?.getAttribute("aria-label")).toBe("tags item 1");
  });
});

describe("when the reader switches between the form and JSON", () => {
  /** @scenario "Switch the request body between the form and JSON" */
  it("shows the form's value as pretty-printed JSON", async () => {
    const value = bodyText();
    await press({ selector: modeButton("json") });
    expect(panel("json")?.hidden).toBe(false);
    expect(panel("form")?.hidden).toBe(true);
    expect(bodyText()).toBe(value);
    expect(bodyText()).toContain('\n  "name": "refunds"');
  });

  /** @scenario "Switch the request body between the form and JSON" */
  it("takes edited JSON back into the form", async () => {
    await type({
      element: byId("pg-body"),
      value: JSON.stringify({
        name: "edited",
        startDate: "2026-01-01",
        tags: ["x", "y", "z"],
        extra: 1,
      }),
    });
    await press({ selector: modeButton("form") });
    expect(panel("form")?.hidden).toBe(false);
    expect(control("name").value).toBe("edited");
    expect(control("expiresAt").value).toBe("");
    expect(document.querySelectorAll('[data-body-list="tags"] [data-body-rows] input').length).toBe(
      3,
    );
    expect(body()).toEqual({
      name: "edited",
      startDate: "2026-01-01",
      tags: ["x", "y", "z"],
      extra: 1,
    });
  });

  /** @scenario "Switch the request body between the form and JSON" */
  it("keeps the reader in JSON when it does not parse or does not fit", async () => {
    await press({ selector: modeButton("json") });
    await type({ element: byId("pg-body"), value: '{"name": ' });
    await press({ selector: modeButton("form") });
    expect(panel("json")?.hidden).toBe(false);
    expect(document.querySelector("[data-request-error]")?.textContent).toContain("Invalid JSON");
    await type({ element: byId("pg-body"), value: '{"name": "a", "pageSize": "lots"}' });
    await press({ selector: modeButton("form") });
    expect(panel("json")?.hidden).toBe(false);
    expect(document.querySelector("[data-request-error]")?.textContent).toContain("pageSize");
    await type({ element: byId("pg-body"), value: '{"name": "a", "startDate": 5}' });
    await press({ selector: modeButton("form") });
    expect(panel("form")?.hidden).toBe(false);
  });
});

describe("when the reader sends the form", () => {
  const fetches: { url: string; body: string }[] = [];
  beforeEach(async () => {
    fetches.length = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init: RequestInit = {}) => {
        fetches.push({ url: String(url), body: typeof init.body === "string" ? init.body : "" });
        return new Response("{}", { status: 200 });
      }),
    );
    await type({ element: byId("pg-auth"), value: "sk-test" });
  });
  async function send() {
    await act(async () => document.getElementById("pg-send")?.click());
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
  }

  /** @scenario "Send and show the form's value as the request body" */
  it("carries the form's value into every example and the request", async () => {
    await type({ element: control("name"), value: "sent" });
    const value = body();
    expect(example("curl")).toContain(JSON.stringify(value));
    expect(example("python")).toContain('"name": "sent"');
    expect(example("typescript")).toContain('"name": "sent"');
    expect(example("agent")).toContain('"name": "sent"');
    await send();
    expect(fetches).toHaveLength(1);
    expect(JSON.parse(fetches[0]?.body ?? "")).toEqual(value);
  });

  /** @scenario "Send and show the form's value as the request body" */
  it("refuses to send with a required field empty or a JSON field that does not parse", async () => {
    await type({ element: control("name"), value: "" });
    await send();
    expect(fetches).toHaveLength(0);
    expect(control("name").getAttribute("aria-invalid")).toBe("true");
    await type({ element: control("name"), value: "ok" });
    await type({ element: control("metadata"), value: "{nope" });
    await send();
    expect(fetches).toHaveLength(0);
    expect(control("metadata").getAttribute("aria-invalid")).toBe("true");
    await type({ element: control("metadata"), value: '{"team": "a"}' });
    await send();
    expect(fetches).toHaveLength(1);
    expect(JSON.parse(fetches[0]?.body ?? "").metadata).toEqual({ team: "a" });
  });

  /** @scenario "Type each parameter by its schema" */
  it("types each parameter and sends a picked date as an ISO timestamp in UTC", async () => {
    expect(byId<HTMLInputElement>("pg-query-since").type).toBe("datetime-local");
    expect(byId("pg-query-order").tagName).toBe("SELECT");
    expect(byId("pg-query-archived").getAttribute("role")).toBe("radiogroup");
    expect(byId<HTMLInputElement>("pg-query-limit")).toMatchObject({
      type: "number",
      min: "1",
      max: "100",
    });
    await type({ element: byId("pg-query-since"), value: "2026-03-01T09:30" });
    await choose({ element: byId("pg-query-order"), value: "desc" });
    await check({
      element: document.querySelector<HTMLInputElement>(
        'input[name="pg-query-archived"][value="true"]',
      )!,
    });
    await type({ element: byId("pg-query-limit"), value: "500" });
    await send();
    expect(fetches).toHaveLength(0);
    expect(byId("pg-query-limit").getAttribute("aria-invalid")).toBe("true");
    await type({ element: byId("pg-query-limit"), value: "10" });
    await send();
    const url = new URL(fetches[0]?.url ?? "");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      since: "2026-03-01T09:30:00Z",
      order: "desc",
      archived: "true",
      limit: "10",
    });
  });
});
