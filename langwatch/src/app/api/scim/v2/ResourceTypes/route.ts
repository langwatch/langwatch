import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
    totalResults: 2,
    itemsPerPage: 2,
    startIndex: 1,
    Resources: [
      {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"],
        id: "User",
        name: "User",
        endpoint: "/api/scim/v2/Users",
        schema: "urn:ietf:params:scim:schemas:core:2.0:User",
        meta: {
          resourceType: "ResourceType",
          location: "/api/scim/v2/ResourceTypes/User",
        },
      },
      {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"],
        id: "Group",
        name: "Group",
        endpoint: "/api/scim/v2/Groups",
        schema: "urn:ietf:params:scim:schemas:core:2.0:Group",
        meta: {
          resourceType: "ResourceType",
          location: "/api/scim/v2/ResourceTypes/Group",
        },
      },
    ],
  });
}
