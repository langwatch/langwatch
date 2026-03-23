export interface ScimUser {
  schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"];
  id: string;
  userName: string;
  name: {
    givenName: string;
    familyName: string;
  };
  emails: Array<{
    primary: boolean;
    value: string;
    type: string;
  }>;
  active: boolean;
  meta: {
    resourceType: "User";
    created: string;
    lastModified: string;
  };
}

export interface ScimListResponse<T> {
  schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"];
  totalResults: number;
  startIndex: number;
  itemsPerPage: number;
  Resources: T[];
}

export interface ScimError {
  schemas: ["urn:ietf:params:scim:api:messages:2.0:Error"];
  status: string;
  detail: string;
}

export interface ScimPatchOperation {
  op: "replace" | "add" | "remove";
  path?: string;
  value?: unknown;
}

export interface ScimPatchRequest {
  schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"];
  Operations: ScimPatchOperation[];
}

export interface ScimCreateUserRequest {
  schemas: string[];
  userName: string;
  name?: {
    givenName?: string;
    familyName?: string;
  };
  emails?: Array<{
    primary?: boolean;
    value: string;
    type?: string;
  }>;
  active?: boolean;
}
