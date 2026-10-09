import { z } from "zod";

import {
  doublewordModelSchema,
  type DoublewordModel,
} from "../../rules/doubleword-models.rules.ts";
import { DoublewordModelChannel, type DoublewordModelList } from "../doubleword-model.channel.ts";

const DOUBLEWORD_MODELS_URL = "https://app.doubleword.ai/admin/api/v1/models?include=pricing";

/** Page size for the admin models endpoint. */
const PAGE_SIZE = 100;

/** Far above the real list, so a `total_count` that never settles cannot page forever. */
const MAX_PAGES = 50;

const modelsPageSchema = z.object({
  data: z.array(z.unknown()).optional(),
  total_count: z.number().optional(),
});

/** Models that do not match the fields the mapper reads are left out rather than half-read. */
function pickWellFormedModels(data: readonly unknown[]): DoublewordModel[] {
  const models: DoublewordModel[] = [];
  for (const raw of data) {
    const model = doublewordModelSchema.safeParse(raw);
    if (model.success) models.push(model.data);
  }
  return models;
}

export class HttpDoublewordModelChannel extends DoublewordModelChannel {
  private constructor(private readonly request: typeof fetch) {
    super();
  }

  static create({ request = fetch }: { request?: typeof fetch } = {}): HttpDoublewordModelChannel {
    return new HttpDoublewordModelChannel(request);
  }

  /** Reads every page until `total_count` is reached, a page comes back empty, or `MAX_PAGES`. */
  async fetchModels({ apiKey }: { apiKey: string }): Promise<DoublewordModelList> {
    const models: DoublewordModel[] = [];
    let received = 0;
    for (let pageIndex = 0; pageIndex < MAX_PAGES; pageIndex++) {
      const skip = pageIndex * PAGE_SIZE;
      let body: unknown;
      try {
        const response = await this.request(
          `${DOUBLEWORD_MODELS_URL}&limit=${PAGE_SIZE}&skip=${skip}`,
          { headers: { Authorization: `Bearer ${apiKey}` } },
        );
        if (!response.ok) {
          return { outcome: "unavailable", reason: "http_status", detail: String(response.status) };
        }
        body = await response.json();
      } catch (error) {
        return {
          outcome: "unavailable",
          reason: "transport_failed",
          detail: error instanceof Error ? error.message : String(error),
        };
      }
      const page = modelsPageSchema.safeParse(body);
      if (!page.success) {
        return { outcome: "unavailable", reason: "malformed_body", detail: page.error.message };
      }
      const data = page.data.data ?? [];
      received += data.length;
      models.push(...pickWellFormedModels(data));
      const total = page.data.total_count ?? received;
      if (data.length === 0 || received >= total) break;
    }
    return { outcome: "fetched", models };
  }
}
