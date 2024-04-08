import { type NextApiRequest, type NextApiResponse } from "next";
import { fromZodError, type ZodError } from "zod-validation-error";
import { prisma } from "../../server/db"; // Adjust the import based on your setup

import { getDebugger } from "../../utils/logger";

import {
  timeseriesSeriesInput,
  type TimeseriesInputType,
} from "../../server/analytics/registry";

import { sharedFiltersInputSchema } from "../../server/analytics/types";
import { timeseries } from "../../server/analytics/timeseries";
import { TRPCError } from "@trpc/server";

export const debug = getDebugger("langwatch:analytics");

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
    const timeseriesResult = await timeseries(params);

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
