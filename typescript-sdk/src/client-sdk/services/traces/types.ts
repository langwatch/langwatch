import type { paths } from "../../../internal/generated/openapi/api-client";
import { BaseRequestOptions } from "../../types";

export interface GetTraceParams {
  includeSpans?: boolean;
}
export interface GetTraceOptions extends BaseRequestOptions { }

export type GetTraceResponse = NonNullable<
  paths["/api/trace/{id}"]["get"]["responses"]["200"]
>["content"]["application/json"];
