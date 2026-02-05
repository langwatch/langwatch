import { TRPCError } from "@trpc/server";
import type { NextApiRequest, NextApiResponse } from "next";
import { fromZodError, type ZodError } from "zod-validation-error";

import { getAnalyticsService } from "../../server/analytics/analytics.service";
import {
  type TimeseriesInputType,
  timeseriesSeriesInput,
} from "../../server/analytics/registry";
import { sharedFiltersInputSchema } from "../../server/analytics/types";
import { prisma } from "../../server/db"; // Adjust the import based on your setup
import { normalizeHeaderValue } from "../../utils/headers";

import { createLogger } from "../../utils/logger";

const _logger = createLogger("langwatch:analytics");

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  if (req.method !== "POST") {
    return res.status(405).end(); // Only accept POST requests
  }

  const authToken = normalizeHeaderValue(req.headers["x-auth-token"]);

  if (!authToken) {
    return res
      .status(401)
      .json({ message: "X-Auth-Token header is required." });
  }

  const project = await prisma.project.findUnique({
    where: { apiKey: authToken },
  });

  if (!project) {
    return res.status(401).json({ message: "Invalid auth token." });
  }

  if (!req.body) {
    return res.status(400).json({ message: "Bad request" });
  }

  const input = req.body;
  input.projectId = project.id;

  let params: TimeseriesInputType;
  try {
    params = sharedFiltersInputSchema
      .extend(timeseriesSeriesInput.shape)
      .parse(input);
  } catch (error) {
    const validationError = fromZodError(error as ZodError);
    return res.status(400).json({ error: validationError.message });
  }

  try {
    const analyticsService = getAnalyticsService();
    const timeseriesResult = await analyticsService.getTimeseries(params);

    return res.status(200).json(timeseriesResult);
  } catch (e) {
    if (e instanceof TRPCError && e.code === "BAD_REQUEST") {
      return res.status(400).json({
        code: e.code,
        message: e.message,
      });
    } else {
      throw e;
    }
  }
}
