import { type NextApiRequest, type NextApiResponse } from "next";
import { prisma } from "../../server/db"; // Adjust the import based on your setup
import { type Span } from "../../server/tracer/types";
import { SPAN_INDEX, esClient } from "../../server/elasticsearch";

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

  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  if (!req.body.spans) {
    // TODO: deeper validation
    return res.status(400).json({ message: "Bad request" });
  }

  const spans: Span[] = (req.body as Record<string, any>).spans;

  const result = await esClient.helpers.bulk({
    datasource: spans,
    pipeline: "ent-search-generic-ingestion",
    onDocument: (doc) => ({ index: { _index: SPAN_INDEX, _id: doc.span_id } }),
  });

  if (result.failed > 0) {
    console.error("Failed to insert to elasticsearch", result);
    return res.status(500).json({ message: "Something went wrong!" });
  }

  return res.status(200).json({ message: "Traces received successfully." });
}
