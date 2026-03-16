import type { NextApiRequest, NextApiResponse } from "next";

/**
 * SCIM 2.0 ServiceProviderConfig endpoint.
 * Returns static configuration describing supported SCIM capabilities.
 */
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  res.setHeader("Content-Type", "application/scim+json");
  return res.status(200).json({
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
    documentationUri: "https://docs.langwatch.ai/scim",
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: 200 },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [
      {
        type: "oauthbearertoken",
        name: "OAuth Bearer Token",
        description:
          "Authentication scheme using the OAuth Bearer Token Standard",
        specUri: "https://www.rfc-editor.org/info/rfc6750",
        primary: true,
      },
    ],
  });
}
