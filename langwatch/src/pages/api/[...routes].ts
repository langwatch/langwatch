import { type NextApiRequest, type NextApiResponse } from "next";
import { dependencies } from "../../injection/dependencies.server";
import { pathToRegexp, type Key } from "path-to-regexp";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const route =
    "/api/" +
    (Array.isArray(req.query.routes)
      ? req.query.routes.join("/")
      : req.query.routes ?? "/");

  for (const [pattern, handler] of Object.entries(
    dependencies.extraApiRoutes ?? []
  )) {
    const keys: Key[] = [];
    const regexp = pathToRegexp(pattern, keys);
    const match = regexp.exec(route);

    if (match) {
      const params = Object.fromEntries(
        keys.map((key, index) => [key.name, match[index + 1]])
      );
      req.query = { ...req.query, ...params };
      return await handler(req, res);
    }
  }

  // No matches
  res.status(404).json({ error: "Not Found" });
}
