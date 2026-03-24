import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
    totalResults: 2,
    itemsPerPage: 2,
    startIndex: 1,
    Resources: [
      {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:Schema"],
        id: "urn:ietf:params:scim:schemas:core:2.0:User",
        name: "User",
        description: "User Account",
        attributes: [
          {
            name: "userName",
            type: "string",
            multiValued: false,
            required: true,
            caseExact: false,
            mutability: "readWrite",
            returned: "default",
            uniqueness: "server",
          },
          {
            name: "name",
            type: "complex",
            multiValued: false,
            required: false,
            mutability: "readWrite",
            returned: "default",
            subAttributes: [
              {
                name: "givenName",
                type: "string",
                multiValued: false,
                required: false,
                mutability: "readWrite",
                returned: "default",
              },
              {
                name: "familyName",
                type: "string",
                multiValued: false,
                required: false,
                mutability: "readWrite",
                returned: "default",
              },
            ],
          },
          {
            name: "emails",
            type: "complex",
            multiValued: true,
            required: false,
            mutability: "readWrite",
            returned: "default",
          },
          {
            name: "active",
            type: "boolean",
            multiValued: false,
            required: false,
            mutability: "readWrite",
            returned: "default",
          },
        ],
        meta: {
          resourceType: "Schema",
          location: "/api/scim/v2/Schemas/urn:ietf:params:scim:schemas:core:2.0:User",
        },
      },
      {
        schemas: ["urn:ietf:params:scim:schemas:core:2.0:Schema"],
        id: "urn:ietf:params:scim:schemas:core:2.0:Group",
        name: "Group",
        description: "Group (maps to LangWatch Team)",
        attributes: [
          {
            name: "displayName",
            type: "string",
            multiValued: false,
            required: true,
            caseExact: false,
            mutability: "readWrite",
            returned: "default",
            uniqueness: "none",
          },
          {
            name: "members",
            type: "complex",
            multiValued: true,
            required: false,
            mutability: "readWrite",
            returned: "default",
            subAttributes: [
              {
                name: "value",
                type: "string",
                multiValued: false,
                required: true,
                mutability: "immutable",
                returned: "default",
                description: "The user ID of the group member",
              },
              {
                name: "display",
                type: "string",
                multiValued: false,
                required: false,
                mutability: "readOnly",
                returned: "default",
              },
            ],
          },
        ],
        meta: {
          resourceType: "Schema",
          location: "/api/scim/v2/Schemas/urn:ietf:params:scim:schemas:core:2.0:Group",
        },
      },
    ],
  });
}
