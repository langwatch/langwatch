import {
  FIELD_VALUES,
  SEARCH_FIELDS,
  type SearchFieldMeta,
  type TraceQueryFieldCatalogueInput,
} from "@langwatch/trace-contract";

import type { TraceQueryFieldValuesPort } from "../ports/query-field-values.port";

const DYNAMIC_VALUES_LIMIT = 20;
const SAMPLES_SHOWN = 8;

type CategoricalSearchField = SearchFieldMeta & {
  facetField: string;
  valueType: "categorical";
};

function isCategoricalSearchField(
  field: SearchFieldMeta,
): field is CategoricalSearchField {
  return field.valueType === "categorical" && field.facetField !== void 0;
}

export class TraceQueryFieldCatalogueService {
  private constructor(private readonly values: TraceQueryFieldValuesPort) {}

  static create(values: TraceQueryFieldValuesPort): TraceQueryFieldCatalogueService {
    return new TraceQueryFieldCatalogueService(values);
  }

  async build(input: TraceQueryFieldCatalogueInput): Promise<string> {
    const dynamicValues = await this.fetchDynamicValues(input);
    const lines: string[] = [];

    for (const [name, metadata] of Object.entries(SEARCH_FIELDS)) {
      const sample = this.pickSampleValues(name, metadata.facetField, dynamicValues);
      const example = sample.length > 0 ? ` — e.g. ${sample.join(", ")}` : "";
      lines.push(`- ${name} (${metadata.valueType}): ${metadata.label}${example}`);
    }

    return lines.join("\n");
  }

  private pickSampleValues(
    fieldName: string,
    facetField: string | undefined,
    dynamic: Map<string, string[]>,
  ): string[] {
    const dynamicValues = facetField ? (dynamic.get(facetField) ?? []) : [];
    const staticValues = FIELD_VALUES[fieldName] ?? [];
    return Array.from(new Set([...dynamicValues, ...staticValues])).slice(
      0,
      SAMPLES_SHOWN,
    );
  }

  private async fetchDynamicValues(
    input: TraceQueryFieldCatalogueInput,
  ): Promise<Map<string, string[]>> {
    const facetFields = Object.values(SEARCH_FIELDS)
      .filter(isCategoricalSearchField)
      .map((metadata) => metadata.facetField);
    const results = await Promise.allSettled(
      facetFields.map((facetKey) =>
        this.values.list({
          ...input,
          facetKey,
          limit: DYNAMIC_VALUES_LIMIT,
          offset: 0,
        }),
      ),
    );
    const dynamic = new Map<string, string[]>();

    results.forEach((result, index) => {
      const facetKey = facetFields[index];
      if (facetKey === void 0 || result.status !== "fulfilled") {
        return;
      }

      dynamic.set(
        facetKey,
        result.value.values.map((value) => value.value),
      );
    });

    return dynamic;
  }
}
