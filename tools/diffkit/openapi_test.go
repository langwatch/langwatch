package diffkit

import "testing"

func TestOperationsResolvesRefsAndSecurity(t *testing.T) {
	document := map[string]any{
		"paths": map[string]any{
			"/api/thing/{id}": map[string]any{
				"post": map[string]any{
					"operationId": "createThing",
					"security":    []any{map[string]any{"project_api_key": []any{}}},
					"parameters":  []any{map[string]any{"name": "id", "in": "path", "required": true, "schema": map[string]any{"type": "string"}}},
					"requestBody": map[string]any{
						"required": true,
						"content": map[string]any{
							"application/json": map[string]any{"schema": map[string]any{"$ref": "#/components/schemas/Thing"}},
						},
					},
				},
			},
		},
		"components": map[string]any{
			"schemas": map[string]any{
				"Thing": map[string]any{"type": "object", "required": []any{"name"}, "properties": map[string]any{"name": map[string]any{"type": "string"}}},
			},
		},
	}
	operations, err := Operations(document)
	if err != nil {
		t.Fatal(err)
	}
	if len(operations) != 1 {
		t.Fatalf("want one operation, got %d", len(operations))
	}
	op := operations[0]
	if op.Method != "POST" || op.Path != "/api/thing/{id}" || op.OperationID != "createThing" {
		t.Fatalf("operation identity wrong: %+v", op)
	}
	if !op.BodyRequired || op.BodySchema["type"] != "object" {
		t.Fatalf("body $ref not resolved: %+v", op.BodySchema)
	}
	if len(op.Security) != 1 || op.Security[0] != "project_api_key" {
		t.Fatalf("security not parsed: %v", op.Security)
	}
	if len(op.Params) != 1 || op.Params[0].In != "path" || !op.Params[0].Required {
		t.Fatalf("params not parsed: %+v", op.Params)
	}
}
