import { type NextApiRequest, type NextApiResponse } from "next";

/**
 * @deprecated - This endpoint is no longer supported
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  return res.status(410).json({ 
    error: "This endpoint is deprecated and no longer supported. Please use the new evaluations API." 
  });
}
