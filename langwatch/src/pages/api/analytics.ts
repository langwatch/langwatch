import { type NextApiRequest, type NextApiResponse } from "next";
import { fromZodError, type ZodError } from "zod-validation-error";
import { prisma } from "../../server/db"; // Adjust the import based on your setup

import { getDebugger } from "../../utils/logger";

import {
  timeseriesInput,
  type SeriesInputType,
} from "../../server/analytics/registry";

import {
  sharedFiltersInputSchema,
  type ApiConfig,
  type SharedFiltersInput,
} from "../../server/analytics/types";
import { timeseries } from "../../server/api/routers/analytics/timeseriesHelpers";

export const debug = getDebugger("langwatch:collector");

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).end(); // Only accept POST requests
  }

  const authToken = req.headers["x-auth-token"];

  if (!authToken) {
    return res
      .status(401)
      .json({ message: "X-Auth-Token header is required." });
  }

  const project = await prisma.project.findUnique({
    where: { apiKey: authToken as string },
  });

  if (!project) {
    return res.status(401).json({ message: "Invalid auth token." });
  }

  if (!req.body) {
    return res.status(400).json({ message: "Bad request" });
  }

  const input = req.body;
  input.projectId = project.id;

  type ApiAnalyticsType = SeriesInputType | SharedFiltersInput;

  let params: ApiAnalyticsType;
  try {
    params = sharedFiltersInputSchema
      .extend(timeseriesInput.shape)
      .parse(input);
  } catch (error) {
    const validationError = fromZodError(error as ZodError);
    return res.status(400).json({ error: validationError.toString() });
  }

  const apiConfig: ApiConfig = "REST";
  const timeseriesResult = await timeseries(params, apiConfig);

  if ("code" in timeseriesResult && timeseriesResult.code) {
    return res.status(400).json(timeseriesResult);
  }

  return res.status(200).json(timeseriesResult);
}
