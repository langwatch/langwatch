import { HttpResponse } from "@smithy/core/protocols";
export const getDateHeader = (response) => HttpResponse.isInstance(response) ? (response.headers?.date ?? response.headers?.Date) : undefined;
export const getAgeHeader = (response) => HttpResponse.isInstance(response) ? (response.headers?.age ?? response.headers?.Age) : undefined;
