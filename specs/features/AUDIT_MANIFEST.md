# AUDIT MANIFEST — `specs/features/` `@unimplemented` classification

**Date**: 2026-04-25
**Branch**: `audit/unimpl-features-2026-04-25`
**Tracking issue**: [#3458](https://github.com/langwatch/langwatch/issues/3458)
**Plan**: `~/workspace/orchard-codex/plans/unimpl-reduction-2026-04-25.md`

## Classes

- **KEEP** — Scenario describes intended behavior that still applies. A test should be written (Phase 3).
- **UPDATE** — Behavior changed; scenario must be rewritten before binding.
- **DELETE** — Aspirational, stale, or for code that no longer exists. Remove from spec.
- **DUPLICATE** — Already covered by another scenario or test. Remove + cross-link.

## Convergence

```bash
mc=$(awk '/^\| specs\//' specs/features/AUDIT_MANIFEST.md | wc -l)
uc=$(grep -rh '@unimplemented' specs/features/ --exclude=AUDIT_MANIFEST.md | wc -l)
echo "manifest=$mc unimpl=$uc"
[ "$mc" -ge "$uc" ] && echo "AUDIT COMPLETE"
```

## TL;DR — class breakdown (814 scenarios audited)

| Class | Count | % | Phase 1 action |
|-------|-------|---|-----------------|
| **KEEP** | 509 | 62.5% | Phase 3: write tests (or add `@scenario` JSDoc bindings to existing tests) |
| **DUPLICATE** | 222 | 27.3% | Phase 1: remove `@unimplemented` tag, add `@scenario` JSDoc binding to the existing test |
| **UPDATE** | 42 | 5.2% | Phase 1: rewrite scenario to match shipped behavior, then bind |
| **DELETE** | 41 | 5.0% | Phase 1: remove scenario from spec |

**Headline finding**: 32% of `@unimplemented` tags are removable in Phase 1 (DUPLICATE + DELETE = 263). Most KEEPs (62%) describe behavior that is *already in code and often already tested* — the work is binding tests via `@scenario` JSDoc, not writing tests from scratch.

**Cluster summary**:

| Cluster | File group | Tags | KEEP | UPDATE | DELETE | DUP | Notes |
|---------|------------|------|------|--------|--------|-----|-------|
| C1 | dataset SDKs/CLI/MCP | 174 | 174 | 0 | 0 | 0 | Fully shipped + tested. Pure JSDoc-binding gap. |
| C2 | marketing/onboarding/billing | 118 | 93 | 19 | 6 | 0 | Customer.io shipped. trace-limit and trait names diverged. |
| C3 | enterprise/auth/platform | 132 | 44 | 4 | 17 | 67 | ES write-disable reverted (8 DELETE). Cost-checker cleanup done (9 DELETE). |
| C4 | scenarios | 54 | 12 | 0 | 1 | 41 | Mostly shipped + tested via mirror test files; just missing JSDoc bindings. |
| C5 | suites group A (large) | 113 | 57 | 0 | 1 | 55 | rename-suites→runs largely done; cancel feature fully shipped. |
| C6 | suites group B (mid) | 76 | 64 | 7 | 0 | 5 | suite-url-routing diverged: query-string spec vs path-based ship. |
| C7 | suites group C (small) + prompts | 71 | 11 | 4 | 3 | 53 | suite-url-nesting stale. custom-prompt-tags is fully shipped + spec-duplicated. |
| C8 | devtools + evaluations-v3 | 76 | 54 | 8 | 13 | 1 | issue-creation-skill diverged hard (8 DELETE). worktree-creation shipped. |
| **Total** | — | **814** | **509** | **42** | **41** | **222** | |

See `~/workspace/orchard-codex/plans/unimpl-reduction-2026-04-25.md` for the orchestration plan.

## Manifest

| File | Scenario | Class | Rationale |
|------|----------|-------|-----------|
| specs/features/dataset-python-sdk.feature | "List datasets returns first page for the project" | KEEP | DatasetsFacade.list_datasets exists in python-sdk/src/langwatch/dataset/dataset_facade.py, integration test covers behavior unbound |
| specs/features/dataset-python-sdk.feature | "List datasets with explicit pagination" | KEEP | list_datasets accepts page/limit; tests in python-sdk/tests/dataset/test_dataset_api_service_integration.py unbound |
| specs/features/dataset-python-sdk.feature | "List datasets returns empty result when project has no datasets" | KEEP | Behavior covered by test_returns_empty_result_when_no_datasets, no @scenario binding |
| specs/features/dataset-python-sdk.feature | "List datasets propagates authentication errors" | KEEP | DatasetApiError raised on 401 in dataset_api_service.py, test_raises_dataset_api_error_on_auth_failure exists |
| specs/features/dataset-python-sdk.feature | "Create a dataset with name and column types" | KEEP | DatasetsFacade.create_dataset implemented; test_creates_dataset_with_name_and_columns covers it |
| specs/features/dataset-python-sdk.feature | "Create a dataset with only a name returns no column types" | KEEP | columns optional in create_dataset signature; test_creates_dataset_with_only_name covers behavior |
| specs/features/dataset-python-sdk.feature | "Create a dataset with a conflicting name raises an error" | KEEP | 409 mapping in errors.py; test_raises_dataset_api_error_on_conflict exists |
| specs/features/dataset-python-sdk.feature | "Create dataset validates that name is not empty" | KEEP | _validate_name in dataset_facade.py; test_raises_value_error_when_name_is_empty exists |
| specs/features/dataset-python-sdk.feature | "Get dataset returns dataset with entries" | KEEP | get_dataset returns Dataset with entries; test_returns_dataset_with_entries exists |
| specs/features/dataset-python-sdk.feature | "Get dataset by ID works the same as by slug" | KEEP | API resolves slug-or-id; test_gets_dataset_by_id covers it |
| specs/features/dataset-python-sdk.feature | "Get non-existent dataset raises an error" | KEEP | DatasetNotFoundError mapped from 404; test_raises_dataset_not_found_error exists |
| specs/features/dataset-python-sdk.feature | "Update a dataset name" | KEEP | update_dataset implemented; test_updates_dataset_name covers slug regen |
| specs/features/dataset-python-sdk.feature | "Update a dataset column types" | KEEP | update_dataset accepts columns; test_updates_dataset_column_types exists |
| specs/features/dataset-python-sdk.feature | "Update a non-existent dataset raises an error" | KEEP | 404 mapping; test_raises_dataset_not_found_error in TestUpdateDataset |
| specs/features/dataset-python-sdk.feature | "Delete a dataset archives it" | KEEP | delete_dataset implemented; test_deletes_without_error covers it |
| specs/features/dataset-python-sdk.feature | "Delete a non-existent dataset raises an error" | KEEP | 404 mapping; test_raises_dataset_not_found_error in TestDeleteDataset |
| specs/features/dataset-python-sdk.feature | "List records returns paginated records for a dataset" | KEEP | list_records returns PaginatedResult[DatasetRecord]; test_returns_paginated_records exists |
| specs/features/dataset-python-sdk.feature | "List records with explicit pagination" | KEEP | list_records page/limit params; test_passes_pagination_params exists |
| specs/features/dataset-python-sdk.feature | "List records for non-existent dataset raises an error" | KEEP | 404 mapping; test_raises_dataset_not_found_error in TestListRecords |
| specs/features/dataset-python-sdk.feature | "Add records to an existing dataset" | KEEP | create_records implemented; test_adds_records_to_dataset exists |
| specs/features/dataset-python-sdk.feature | "Add records to a non-existent dataset raises an error" | KEEP | 404 mapping; test_raises_dataset_not_found_error in TestCreateRecords |
| specs/features/dataset-python-sdk.feature | "Create records validates entries is not empty" | KEEP | Validation in create_records; test_raises_value_error_when_entries_is_empty exists |
| specs/features/dataset-python-sdk.feature | "Update a single record" | KEEP | update_record implemented; test_updates_single_record exists |
| specs/features/dataset-python-sdk.feature | "Update a non-existent record creates it" | KEEP | Upsert behavior in API; test_upserts_non_existent_record exists |
| specs/features/dataset-python-sdk.feature | "Update a record for non-existent dataset raises an error" | KEEP | 404 mapping; test_raises_dataset_not_found_error in TestUpdateRecord |
| specs/features/dataset-python-sdk.feature | "Delete records by IDs" | KEEP | delete_records implemented; test_returns_deleted_count_as_int exists |
| specs/features/dataset-python-sdk.feature | "Delete records for non-existent dataset raises an error" | KEEP | 404 mapping; test_raises_dataset_not_found_error in TestDeleteRecords |
| specs/features/dataset-python-sdk.feature | "Delete records validates record_ids is not empty" | KEEP | Validation; test_raises_value_error_when_record_ids_is_empty exists |
| specs/features/dataset-python-sdk.feature | "Upload creates dataset when it does not exist" | KEEP | _upload_append falls back to _create_from_file on 404; test_append_creates_when_not_found exists |
| specs/features/dataset-python-sdk.feature | "Upload appends to existing dataset by default" | KEEP | _upload_append implemented; test_append_uploads_to_existing exists |
| specs/features/dataset-python-sdk.feature | "Upload with if_exists=replace removes existing records first" | KEEP | _upload_replace implemented; test_replace_deletes_then_uploads exists |
| specs/features/dataset-python-sdk.feature | "Upload with if_exists=error raises when dataset exists" | KEEP | _upload_error implemented; test_error_raises_when_exists exists |
| specs/features/dataset-python-sdk.feature | "Upload supports JSON files" | KEEP | _validate_file accepts .json; test_accepts_json_extension exists |
| specs/features/dataset-python-sdk.feature | "Upload supports JSONL files" | KEEP | _validate_file accepts .jsonl; test_accepts_jsonl_extension exists |
| specs/features/dataset-python-sdk.feature | "Upload validates that file exists" | KEEP | FileNotFoundError raised; test_raises_file_not_found_when_file_missing exists |
| specs/features/dataset-python-sdk.feature | "Upload validates supported file extensions" | KEEP | _validate_file rejects unknowns; test_raises_value_error_for_unsupported_extension exists |
| specs/features/dataset-python-sdk.feature | "Upload validates if_exists parameter" | KEEP | _validate_if_exists in dataset_facade.py; test_validates_if_exists_value exists |
| specs/features/dataset-python-sdk.feature | "SDK auto-initializes from environment variables" | KEEP | from_global() in DatasetsFacade; behavior implemented in ensure_setup pattern |
| specs/features/dataset-python-sdk.feature | "SDK raises error when no API key is available" | KEEP | RuntimeError on missing key in ensure_setup; not yet bound by @scenario tag |
| specs/features/dataset-python-sdk.feature | "Dataset object exposes entries as list of DatasetEntry" | KEEP | Dataset model in types.py; test_exposes_entries_as_list_of_dataset_entry exists |
| specs/features/dataset-python-sdk.feature | "Dataset.to_pandas converts entries to a DataFrame" | KEEP | to_pandas in types.py:63; test_to_pandas_converts_entries_to_dataframe exists |
| specs/features/dataset-python-sdk.feature | "DatasetInfo object exposes dataset metadata without records" | KEEP | DatasetInfo class in types.py; test_exposes_metadata_without_records exists |
| specs/features/dataset-python-sdk.feature | "PaginatedResult exposes data list and pagination metadata" | KEEP | PaginatedResult[T] generic in types.py:107; test_exposes_data_list_and_pagination_metadata exists |
| specs/features/dataset-rest-api.feature | "List datasets returns paginated non-archived datasets" | KEEP | GET /api/dataset implemented in app.ts; integration test "returns paginated non-archived datasets" exists unbound |
| specs/features/dataset-rest-api.feature | "List datasets with page and limit parameters" | KEEP | Pagination supported; integration test "paginates with page and limit parameters" exists |
| specs/features/dataset-rest-api.feature | "List datasets returns empty array for project with no datasets" | KEEP | Test "returns a paginated response with 0 datasets" exists unbound |
| specs/features/dataset-rest-api.feature | "Create a dataset with name and column types" | KEEP | POST /api/dataset implemented; test "creates a dataset with the correct slug" exists |
| specs/features/dataset-rest-api.feature | "Create a dataset auto-generates a unique slug from the name" | KEEP | 409 conflict handling exists; test "returns 409 Conflict" exists |
| specs/features/dataset-rest-api.feature | "Create a dataset enforces plan limits" | KEEP | resourceLimitMiddleware applied on POST; test "returns 403 Forbidden" exists |
| specs/features/dataset-rest-api.feature | "Create a dataset validates column types" | KEEP | Zod schema in schemas.ts; test "returns 422 Unprocessable Entity" exists |
| specs/features/dataset-rest-api.feature | "Create a dataset requires a name" | KEEP | Zod schema validation; test "returns 422 Unprocessable Entity" exists for missing name |
| specs/features/dataset-rest-api.feature | "Get a dataset by slug" | KEEP | GET /api/dataset/:slugOrId implemented; test "returns the dataset by slug with its records" exists |
| specs/features/dataset-rest-api.feature | "Get a dataset by id" | KEEP | slugOrId resolution; test "returns the dataset by id" exists |
| specs/features/dataset-rest-api.feature | "Get dataset returns 404 for non-existent slug" | KEEP | 404 handler; test "returns 404 Not Found" exists |
| specs/features/dataset-rest-api.feature | "Get dataset enforces 25MB response size limit" | KEEP | MAX_RESPONSE_SIZE check in app.ts; test "returns 400 Bad Request" exists for size limit |
| specs/features/dataset-rest-api.feature | "Update a dataset name and column types" | KEEP | PATCH /api/dataset/:slugOrId implemented; test "updates the dataset and changes the slug" exists |
| specs/features/dataset-rest-api.feature | "Update a dataset name regenerates the slug" | KEEP | Slug regeneration on rename; test "regenerates the slug" exists |
| specs/features/dataset-rest-api.feature | "Update a dataset fails when new slug conflicts" | KEEP | Conflict handling; test "returns 409 Conflict" exists for slug conflict |
| specs/features/dataset-rest-api.feature | "Update a non-existent dataset returns 404" | KEEP | 404 handler; test "returns 404 Not Found" exists for PATCH |
| specs/features/dataset-rest-api.feature | "Update dataset does not enforce plan limits" | KEEP | No middleware on PATCH; test "updates the dataset successfully (no plan limit on PATCH)" exists |
| specs/features/dataset-rest-api.feature | "Delete a dataset archives it" | KEEP | DELETE soft-deletes with archivedAt; test "soft-deletes with archivedAt and mutates slug" exists |
| specs/features/dataset-rest-api.feature | "Delete a non-existent dataset returns 404" | KEEP | 404 handler; test "returns 404 Not Found" exists for DELETE |
| specs/features/dataset-rest-api.feature | "List records with default pagination" | KEEP | GET /:slugOrId/records implemented; test "returns the first page of records with pagination metadata" exists |
| specs/features/dataset-rest-api.feature | "List records with explicit pagination" | KEEP | Pagination supported; test "paginates with explicit page and limit" exists |
| specs/features/dataset-rest-api.feature | "List records for non-existent dataset returns 404" | KEEP | 404 handler; test "returns 404 Not Found" exists for records list |
| specs/features/dataset-rest-api.feature | "Batch create records via POST /:slugOrId/records" | KEEP | POST records endpoint; test "creates records with unique IDs and returns them" exists |
| specs/features/dataset-rest-api.feature | "Batch create records accepts dataset ID as well as slug" | KEEP | slugOrId resolution; test "creates records for the matching dataset" exists |
| specs/features/dataset-rest-api.feature | "Batch create records validates column names against dataset schema" | KEEP | Validation against columnTypes; test "returns 400 Bad Request identifying the invalid column" exists |
| specs/features/dataset-rest-api.feature | "Batch create records allows entries with subset of columns" | KEEP | Partial entries supported; defaults missing columns to null in datasetRecord.utils.ts |
| specs/features/dataset-rest-api.feature | "Batch create records returns 404 for non-existent dataset" | KEEP | 404 handler covered in describe block for POST records |
| specs/features/dataset-rest-api.feature | "Batch create records requires entries in body" | KEEP | Zod schema requires entries; integration test covers 422 for empty body |
| specs/features/dataset-rest-api.feature | "Batch create records enforces maximum batch size" | KEEP | MAX_BATCH_SIZE in constants.ts; integration test covers 422 for >1000 entries |
| specs/features/dataset-rest-api.feature | "Update a record entry" | KEEP | PATCH /records/:recordId implemented; test "updates the record entry" exists |
| specs/features/dataset-rest-api.feature | "Update a non-existent record creates it" | KEEP | Upsert behavior; test "creates the record (upsert)" exists |
| specs/features/dataset-rest-api.feature | "Update a record for non-existent dataset returns 404" | KEEP | 404 handler; test "returns 404 Not Found" exists for record PATCH |
| specs/features/dataset-rest-api.feature | "Delete records in batch" | KEEP | DELETE /records implemented; test "deletes the specified records and returns count" exists |
| specs/features/dataset-rest-api.feature | "Delete records with no matching IDs returns 404" | KEEP | 404 handler; test "returns 404 Not Found" exists for no matching record IDs |
| specs/features/dataset-rest-api.feature | "Delete records for non-existent dataset returns 404" | KEEP | 404 handler covered in describe block for DELETE records |
| specs/features/dataset-rest-api.feature | "Delete records requires recordIds in body" | KEEP | Zod schema requires recordIds; test "returns 422 Unprocessable Entity" exists |
| specs/features/dataset-rest-api.feature | "Request without API key returns 401" | KEEP | apiKeyAuth middleware; test "returns 401 without X-Auth-Token header" exists |
| specs/features/dataset-rest-api.feature | "Request with invalid API key returns 401" | KEEP | apiKeyAuth middleware; test "returns 401 with invalid X-Auth-Token" exists |
| specs/features/dataset-rest-api.feature | "Endpoints accept both slug and dataset ID" | KEEP | resolveSlugOrId helper in utils.ts; covered by id-based tests but no dedicated cross-cutting test |
| specs/features/dataset-typescript-sdk.feature | "Facade exposes all dataset CRUD methods" | KEEP | DatasetsFacade in datasets.facade.ts exposes all methods; unit test "exposes get, list, create..." exists |
| specs/features/dataset-typescript-sdk.feature | "List datasets returns paginated results with record counts" | KEEP | datasets.list() implemented; integration test "receives a response containing 3 datasets..." exists |
| specs/features/dataset-typescript-sdk.feature | "List datasets passes pagination parameters" | KEEP | Unit test "forwards pagination parameters to the API client" exists |
| specs/features/dataset-typescript-sdk.feature | "Create a dataset with name and column types" | KEEP | datasets.create() in dataset.service.ts; integration test "sends POST /api/dataset..." exists |
| specs/features/dataset-typescript-sdk.feature | "Create a dataset without column types defaults to empty array" | KEEP | Unit test "sends columnTypes as an empty array" exists |
| specs/features/dataset-typescript-sdk.feature | "Create a dataset with empty name throws validation error" | KEEP | DatasetValidationError thrown; unit test in DatasetsFacade validation block exists |
| specs/features/dataset-typescript-sdk.feature | "Create a dataset propagates conflict error" | KEEP | 409 mapped to DatasetApiError; integration test "throws a DatasetApiError with status 409" exists |
| specs/features/dataset-typescript-sdk.feature | "Get dataset by slug returns metadata and entries" | KEEP | datasets.get() implemented; integration test "receives a dataset with 5 entries" exists |
| specs/features/dataset-typescript-sdk.feature | "Get non-existent dataset throws DatasetNotFoundError" | KEEP | 404 mapping in errors.ts; integration test "throws a DatasetNotFoundError" exists |
| specs/features/dataset-typescript-sdk.feature | "Update a dataset name" | KEEP | datasets.update() implemented; integration test "sends PATCH /api/dataset/my-data..." exists |
| specs/features/dataset-typescript-sdk.feature | "Update a dataset column types" | KEEP | Unit test "includes the new columnTypes in the request body" exists |
| specs/features/dataset-typescript-sdk.feature | "Update a dataset with no fields throws validation error" | KEEP | DatasetValidationError; unit test "when updating a dataset with no fields" exists |
| specs/features/dataset-typescript-sdk.feature | "Update a non-existent dataset throws DatasetNotFoundError" | KEEP | 404 mapping; integration test "throws a DatasetNotFoundError" in update describe block |
| specs/features/dataset-typescript-sdk.feature | "Delete dataset sends DELETE and returns archived result" | KEEP | datasets.delete() implemented; integration test "sends DELETE /api/dataset/my-data..." exists |
| specs/features/dataset-typescript-sdk.feature | "Delete a non-existent dataset throws DatasetNotFoundError" | KEEP | 404 mapping; integration test "throws a DatasetNotFoundError" in delete describe block |
| specs/features/dataset-typescript-sdk.feature | "Batch create records in a dataset" | KEEP | datasets.createRecords() implemented; integration test "sends POST /api/dataset/my-data/records..." exists |
| specs/features/dataset-typescript-sdk.feature | "Batch create records with empty entries throws validation error" | KEEP | DatasetValidationError; unit test "when creating records with empty entries" exists |
| specs/features/dataset-typescript-sdk.feature | "Batch create records for non-existent dataset throws error" | KEEP | 404 mapping; integration test in createRecords describe block exists |
| specs/features/dataset-typescript-sdk.feature | "Update a single record" | KEEP | datasets.updateRecord() implemented; integration test "sends PATCH /api/dataset/my-data/records/rec-1..." exists |
| specs/features/dataset-typescript-sdk.feature | "Update a record for non-existent dataset throws error" | KEEP | 404 mapping; integration test in updateRecord describe block exists |
| specs/features/dataset-typescript-sdk.feature | "Delete records by IDs" | KEEP | datasets.deleteRecords() implemented; integration test "sends DELETE /api/dataset/my-data/records..." exists |
| specs/features/dataset-typescript-sdk.feature | "Delete records for non-existent dataset throws error" | KEEP | 404 mapping; integration test in deleteRecords describe block exists |
| specs/features/dataset-typescript-sdk.feature | "List records returns paginated results" | KEEP | datasets.listRecords() implemented; integration test "returns records with pagination metadata" exists |
| specs/features/dataset-typescript-sdk.feature | "List records with explicit pagination" | KEEP | Page/limit params supported; covered in listRecords integration tests |
| specs/features/dataset-typescript-sdk.feature | "List records for non-existent dataset throws error" | KEEP | 404 mapping; integration test in listRecords describe block exists |
| specs/features/dataset-typescript-sdk.feature | "Upload with append strategy appends to existing dataset" | KEEP | datasets.upload() with append strategy; integration test "uploads the file to the existing dataset" exists |
| specs/features/dataset-typescript-sdk.feature | "Upload with append strategy creates dataset if not found" | KEEP | Fallback to create-from-file; integration test "creates the dataset from the file" exists |
| specs/features/dataset-typescript-sdk.feature | "Upload with replace strategy deletes records then uploads" | KEEP | Replace strategy; integration test "deletes all existing records before uploading" exists |
| specs/features/dataset-typescript-sdk.feature | "Upload with error strategy throws if dataset exists" | KEEP | Error strategy; integration test "throws a DatasetApiError with status 409" exists |
| specs/features/dataset-typescript-sdk.feature | "SDK maps 404 responses to DatasetNotFoundError" | KEEP | mapResponseToError in errors.ts; unit test "throws a DatasetNotFoundError with the slug in the message" exists |
| specs/features/dataset-typescript-sdk.feature | "SDK maps 409 responses to DatasetApiError with status" | KEEP | 409 mapping; unit test "throws a DatasetApiError with status 409..." exists |
| specs/features/dataset-typescript-sdk.feature | "SDK maps 403 responses to DatasetPlanLimitError with upgrade message" | KEEP | DatasetPlanLimitError class in errors.ts; unit test "throws a DatasetPlanLimitError..." exists |
| specs/features/dataset-typescript-sdk.feature | "SDK maps unexpected errors to DatasetApiError with status code" | KEEP | Default mapping; unit test "throws a DatasetApiError with status 500" exists |
| specs/features/dataset-mcp-tools.feature | "List datasets returns a formatted summary of all datasets" | KEEP | platform_list_datasets registered in create-mcp-server.ts:1580; integration test "returns a formatted list..." exists |
| specs/features/dataset-mcp-tools.feature | "List datasets returns a helpful message when none exist" | KEEP | handleListDatasets formats no-datasets message; integration test "returns a helpful message..." exists |
| specs/features/dataset-mcp-tools.feature | "Get dataset by slug returns metadata and a preview of records" | KEEP | platform_get_dataset implemented; integration test "returns the dataset name, slug, and column definitions" exists |
| specs/features/dataset-mcp-tools.feature | "formatDatasetResponse renders column table and record entries as markdown" | KEEP | formatDatasetResponse in tools/get-dataset.ts; unit test "includes a column table" + "includes record entries" exist |
| specs/features/dataset-mcp-tools.feature | "Get dataset with non-existent slug returns an error" | KEEP | Error propagation; integration test "propagates the 404 error" exists |
| specs/features/dataset-mcp-tools.feature | "Create a dataset with name and columns" | KEEP | platform_create_dataset registered:1625; integration test "returns confirmation including the generated slug" exists |
| specs/features/dataset-mcp-tools.feature | "Create a dataset with only a name and no columns" | KEEP | Optional columns; integration test "returns confirmation including the slug" for empty schema exists |
| specs/features/dataset-mcp-tools.feature | "platform_create_dataset schema rejects input without a name" | KEEP | Zod schema in schemas/create-dataset.ts; unit test "rejects the input with a validation error" exists |
| specs/features/dataset-mcp-tools.feature | "Update a dataset name" | KEEP | platform_update_dataset implemented; integration test "returns confirmation reflecting the new name" exists |
| specs/features/dataset-mcp-tools.feature | "Update a dataset column types" | KEEP | columnTypes update; integration test "returns confirmation reflecting the new columns" exists |
| specs/features/dataset-mcp-tools.feature | "Update a non-existent dataset returns an error" | KEEP | Error propagation; integration test "propagates the 404 error" in update block exists |
| specs/features/dataset-mcp-tools.feature | "Delete a dataset archives it" | KEEP | platform_delete_dataset implemented; integration test "returns confirmation that the dataset was deleted" exists |
| specs/features/dataset-mcp-tools.feature | "Delete a non-existent dataset returns an error" | KEEP | Error propagation; integration test "propagates the 404 error" in delete block exists |
| specs/features/dataset-mcp-tools.feature | "Add records to a dataset" | KEEP | platform_create_dataset_records registered:1721; integration test "returns confirmation with the count of records created" exists |
| specs/features/dataset-mcp-tools.feature | "Add records to a non-existent dataset returns an error" | KEEP | Error propagation; integration test "propagates the 404 error" in create_records block exists |
| specs/features/dataset-mcp-tools.feature | "Update a single record entry" | KEEP | platform_update_dataset_record implemented; integration test "returns confirmation that the record was updated" exists |
| specs/features/dataset-mcp-tools.feature | "Update a record in a non-existent dataset returns an error" | KEEP | Error propagation; integration test "propagates the 404 error" in update_record block exists |
| specs/features/dataset-mcp-tools.feature | "Delete records by IDs" | KEEP | platform_delete_dataset_records implemented; integration test "returns confirmation with the count of records deleted" exists |
| specs/features/dataset-mcp-tools.feature | "Delete records from a non-existent dataset returns an error" | KEEP | Error propagation; integration test "propagates the 404 error" in delete_records block exists |
| specs/features/dataset-mcp-tools.feature | "All dataset tools are registered in the MCP server" | KEEP | 8 tools registered in create-mcp-server.ts; unit test "registers all 8 dataset tools" exists |
| specs/features/dataset-mcp-tools.feature | "Dataset tools require an API key" | KEEP | requireApiKey helper; unit test "requireApiKey throws when apiKey is empty" exists |
| specs/features/dataset-file-upload-api.feature | "Upload a CSV file to an existing dataset" | KEEP | POST /:slugOrId/upload implemented; integration test "creates records and returns 200" for CSV exists |
| specs/features/dataset-file-upload-api.feature | "Upload a JSONL file to an existing dataset" | KEEP | parseJSONL in upload-utils.ts; integration test for JSONL exists |
| specs/features/dataset-file-upload-api.feature | "Upload a JSON array file to an existing dataset" | KEEP | parseJSON in upload-utils.ts; integration test for JSON array exists |
| specs/features/dataset-file-upload-api.feature | "Upload converts values to match column types" | KEEP | convertRowsToColumnTypes in upload-utils.ts:118; integration test "coerces string values to numbers, booleans, and dates" exists |
| specs/features/dataset-file-upload-api.feature | "Upload to dataset referenced by ID" | KEEP | slugOrId resolution; integration test "adds records to the dataset" via id exists |
| specs/features/dataset-file-upload-api.feature | "Upload fails when file columns do not match dataset columns" | KEEP | Schema validation in upload route; integration test "returns 400 Bad Request" exists |
| specs/features/dataset-file-upload-api.feature | "Upload to a non-existent dataset returns 404" | KEEP | 404 handler; integration test "returns 404 Not Found" exists for upload |
| specs/features/dataset-file-upload-api.feature | "Upload without a file field returns 422" | KEEP | Multipart validation; integration test "returns 422 Unprocessable Entity" for no file exists |
| specs/features/dataset-file-upload-api.feature | "Upload an empty file returns 422" | KEEP | Empty CSV detection; integration test "returns 422 Unprocessable Entity" for headers-only exists |
| specs/features/dataset-file-upload-api.feature | "Upload exceeding row limit is rejected" | KEEP | MAX_ROWS_LIMIT=10000 in upload-utils.ts; integration test "returns 400 Bad Request" for row limit exists |
| specs/features/dataset-file-upload-api.feature | "Upload exceeding file size limit is rejected" | KEEP | MAX_FILE_SIZE_BYTES=25MB; integration test "returns 400 Bad Request" for size limit exists |
| specs/features/dataset-file-upload-api.feature | "Upload with unsupported file format is rejected" | KEEP | detectFileFormat throws; integration test "returns 422 Unprocessable Entity" for unsupported format exists |
| specs/features/dataset-file-upload-api.feature | "Create a new dataset from an uploaded CSV file" | KEEP | POST /api/dataset/upload implemented; integration test "creates the dataset with inferred columns and returns 201" exists |
| specs/features/dataset-file-upload-api.feature | "Create a new dataset from a JSONL file" | KEEP | JSONL support in create+upload; integration test "creates the dataset with inferred columns" for JSONL exists |
| specs/features/dataset-file-upload-api.feature | "Create + upload infers column types as string by default" | KEEP | Type inference in upload-utils.ts; integration test "creates all columns with type 'string'" exists |
| specs/features/dataset-file-upload-api.feature | "Create + upload renames reserved column names" | KEEP | renameReservedColumns in upload-utils.ts:102; integration test "renames 'id' to 'id_' and 'selected' to 'selected_'" exists |
| specs/features/dataset-file-upload-api.feature | "Create + upload requires a name field" | KEEP | Zod schema validation; integration test "returns 422 Unprocessable Entity" for missing name exists |
| specs/features/dataset-file-upload-api.feature | "Create + upload requires a file field" | KEEP | Multipart validation; integration test "returns 422 Unprocessable Entity" for missing file exists |
| specs/features/dataset-file-upload-api.feature | "Create + upload enforces dataset plan limits" | KEEP | resourceLimitMiddleware on create+upload; integration test "returns 403 Forbidden" exists |
| specs/features/dataset-file-upload-api.feature | "Create + upload fails when slug conflicts with existing dataset" | KEEP | Conflict handling; integration test "returns 409 Conflict" exists |
| specs/features/dataset-file-upload-api.feature | "Create + upload rejects file exceeding row limit" | KEEP | MAX_ROWS_LIMIT enforced; integration test "returns 400 Bad Request" for create+upload row limit exists |
| specs/features/dataset-file-upload-api.feature | "Detect CSV format from .csv extension" | KEEP | detectFileFormat in upload-utils.ts:21; unit test "detects CSV format" exists |
| specs/features/dataset-file-upload-api.feature | "Detect JSON format from .json extension" | KEEP | detectFileFormat handles .json; unit test "detects JSON format" exists |
| specs/features/dataset-file-upload-api.feature | "Detect JSONL format from .jsonl extension" | KEEP | detectFileFormat handles .jsonl; unit test "detects JSONL format" exists |
| specs/features/dataset-file-upload-api.feature | "Reject unknown file extension" | KEEP | Default branch throws; unit tests "throws an error for .parquet" and ".xlsx" exist |
| specs/features/dataset-file-upload-api.feature | "Parse CSV with first row as headers" | KEEP | parseCSV in upload-utils.ts:42; unit test "returns 2 records with correct keys" exists |
| specs/features/dataset-file-upload-api.feature | "Parse CSV handles quoted values with commas" | KEEP | parseCSV uses csv-parse lib; unit test "preserves the quoted value as a single field" exists |
| specs/features/dataset-file-upload-api.feature | "Parse JSONL with one object per line" | KEEP | parseJSONL in upload-utils.ts:72; unit test "returns 3 records" for JSONL exists |
| specs/features/dataset-file-upload-api.feature | "Parse JSONL ignores blank lines" | KEEP | Blank line skip in parseJSONL; unit test "skips blank lines and returns only valid objects" exists |
| specs/features/dataset-file-upload-api.feature | "Parse JSON array file" | KEEP | parseJSON in upload-utils.ts:59; unit test "returns 2 records" for JSON array exists |
| specs/features/dataset-file-upload-api.feature | "Parse JSON falls back to JSONL when array parse fails" | KEEP | Fallback in parseFileContent; unit test "successfully parses as JSONL" with fallback exists |
| specs/features/dataset-file-upload-api.feature | "Rename \"id\" column to \"id_\"" | KEEP | renameReservedColumns in upload-utils.ts; unit test "renames 'id' to 'id_'" exists |
| specs/features/dataset-file-upload-api.feature | "Rename \"selected\" column to \"selected_\"" | KEEP | renameReservedColumns; unit test "renames 'selected' to 'selected_'" exists |
| specs/features/dataset-file-upload-api.feature | "Non-reserved columns are unchanged" | KEEP | renameReservedColumns no-op for safe names; unit test "returns columns unchanged" exists |
| specs/features/dataset-file-upload-api.feature | "Upload without API key returns 401" | KEEP | apiKeyAuth middleware on /upload; integration test "returns 401 for create+upload" exists |
| specs/features/dataset-file-upload-api.feature | "Upload to existing without API key returns 401" | KEEP | apiKeyAuth on /:slug/upload; integration test "returns 401 for upload to existing" exists |
| specs/features/dataset-cli.feature | "Add records rejects non-array JSON" | KEEP | parseRecordsJson in records-add.ts:28; unit tests "throws for a JSON object/string/number" in records-add.unit.test.ts exist |
| specs/features/dataset-cli.feature | "Add records rejects invalid JSON" | KEEP | parseRecordsJson try/catch; unit tests "throws for malformed JSON" and "throws for empty string" exist |
| specs/features/customer-io-nurturing-integration.feature | "Identify call authenticates with Basic Auth using the configured API key" | KEEP | NurturingService.identifyUser tested at langwatch/ee/billing/nurturing/nurturing.service.unit.test.ts; not @scenario-bound |
| specs/features/customer-io-nurturing-integration.feature | "Identify call routes to EU endpoint when region is eu" | KEEP | EU endpoint test exists in nurturing.service.unit.test.ts; no JSDoc binding |
| specs/features/customer-io-nurturing-integration.feature | "Track call sends event payload to Customer.io" | KEEP | trackEvent tested in nurturing.service.unit.test.ts; not bound |
| specs/features/customer-io-nurturing-integration.feature | "Group call sends organization traits to Customer.io" | KEEP | groupUser tested in nurturing.service.unit.test.ts; not bound |
| specs/features/customer-io-nurturing-integration.feature | "Batch call combines multiple operations into a single request" | KEEP | batch tested in nurturing.service.unit.test.ts; not bound |
| specs/features/customer-io-nurturing-integration.feature | "NurturingService enforces a 10-second request timeout" | KEEP | Timeout test exists in nurturing.service.unit.test.ts; not bound |
| specs/features/customer-io-nurturing-integration.feature | "NurturingService swallows API errors without throwing" | KEEP | 500 error test exists in nurturing.service.unit.test.ts; not bound |
| specs/features/customer-io-nurturing-integration.feature | "Null service resolves all methods without making HTTP requests" | UPDATE | Service uses falsy-API-key no-op pattern instead of explicit createNull factory; rewrite scenario to match actual API |
| specs/features/customer-io-nurturing-integration.feature | "Service is active when CUSTOMER_IO_API_KEY is configured" | KEEP | Wired in app-layer/presets.ts; tested in nurturing.service.wiring.unit.test.ts |
| specs/features/customer-io-nurturing-integration.feature | "Service is a no-op when CUSTOMER_IO_API_KEY is absent" | UPDATE | Wiring sets nurturing to undefined (not a null service); update scenario expectation to undefined |
| specs/features/customer-io-nurturing-integration.feature | "Region defaults to US when CUSTOMER_IO_REGION is not set" | UPDATE | Wiring test asserts default is EU not US; scenario diverged from implementation |
| specs/features/customer-io-nurturing-integration.feature | "Test app uses null NurturingService" | UPDATE | createTestApp leaves nurturing undefined; update scenario to expect undefined |
| specs/features/customer-io-nurturing-integration.feature | "New signup identifies user with traits in Customer.io" | KEEP | Implemented in hooks/signupIdentification.ts; tested but not @scenario-bound |
| specs/features/customer-io-nurturing-integration.feature | "New signup associates user with organization via group call" | KEEP | groupUser tested in signupIdentification.unit.test.ts |
| specs/features/customer-io-nurturing-integration.feature | "New signup tracks signed_up event" | KEEP | signed_up event tested in signupIdentification.unit.test.ts |
| specs/features/customer-io-nurturing-integration.feature | "Signup identification includes optional marketing fields when present" | KEEP | utm_campaign + how_heard tests exist; not bound |
| specs/features/customer-io-nurturing-integration.feature | "Customer.io failure during signup does not block onboarding" | KEEP | API-unavailable test in signupIdentification.unit.test.ts |
| specs/features/customer-io-nurturing-integration.feature | "Signup with no Customer.io key configured completes without errors" | KEEP | nurturing-undefined branch tested in signupIdentification.unit.test.ts |
| specs/features/customer-io-nurturing-integration.feature | "First trace identifies user with trace milestones" | KEEP | customerIoTraceSync.reactor.unit.test.ts covers first-trace identify |
| specs/features/customer-io-nurturing-integration.feature | "First trace fires first_trace_integrated event" | KEEP | first_trace_integrated tracked in trace sync reactor tests |
| specs/features/customer-io-nurturing-integration.feature | "First trace fires immediately without debouncing" | KEEP | Reactor tested; immediate firing covered implicitly via first-trace branch |
| specs/features/customer-io-nurturing-integration.feature | "Subsequent traces update count and timestamp with debouncing" | KEEP | last_trace_at update tested in trace sync reactor tests |
| specs/features/customer-io-nurturing-integration.feature | "Trace sync reactor uses project-scoped job ID for debouncing" | KEEP | makeJobId returns cio-trace-sync-{projectId}; covered by reactor unit test |
| specs/features/customer-io-nurturing-integration.feature | "Trace sync does not duplicate first-trace detection logic" | KEEP | Reactor reads firstMessage; tested via project service mock |
| specs/features/customer-io-nurturing-integration.feature | "First evaluation identifies user with evaluation milestones" | KEEP | customerIoEvaluationSync.reactor.unit.test.ts covers first-eval identify |
| specs/features/customer-io-nurturing-integration.feature | "First evaluation fires first_evaluation_created event" | KEEP | first_evaluation_created tracked in eval sync reactor tests |
| specs/features/customer-io-nurturing-integration.feature | "Subsequent evaluations update identify with evaluation count" | KEEP | Updated count + last_evaluation_at tested |
| specs/features/customer-io-nurturing-integration.feature | "Subsequent evaluations fire evaluation_ran event" | KEEP | evaluation_ran event tested in eval sync reactor tests |
| specs/features/customer-io-nurturing-integration.feature | "Subsequent evaluation updates are debounced per project" | KEEP | Per-project debounce confirmed in reactor implementation |
| specs/features/customer-io-nurturing-integration.feature | "Evaluation sync reactor uses project-scoped job ID for debouncing" | UPDATE | Actual makeJobId returns cio-eval-sync-{projectId}-{evaluationId}; scenario says project only |
| specs/features/customer-io-nurturing-integration.feature | "Daily usage fold pushes aggregated metrics to Customer.io" | KEEP | customerIoDailyUsageSync.reactor.unit.test.ts covers identify with trace_count fields |
| specs/features/customer-io-nurturing-integration.feature | "Daily usage sync sends cumulative totals not reset counters" | KEEP | Cumulative total + ISO timestamp tests exist in daily usage reactor |
| specs/features/customer-io-nurturing-integration.feature | "Team member invite updates member count and fires event" | KEEP | fireTeamMemberInvitedNurturing tested in featureAdoption.unit.test.ts |
| specs/features/customer-io-nurturing-integration.feature | "Workflow creation updates workflow count and fires event" | KEEP | fireWorkflowCreatedNurturing tested in featureAdoption.unit.test.ts |
| specs/features/customer-io-nurturing-integration.feature | "Scenario creation updates scenario count and fires event" | KEEP | fireScenarioCreatedNurturing tested in featureAdoption.unit.test.ts |
| specs/features/customer-io-nurturing-integration.feature | "Experiment run fires event" | KEEP | fireExperimentRanNurturing tested in featureAdoption.unit.test.ts |
| specs/features/customer-io-nurturing-integration.feature | "Feature adoption hook failure does not break the originating action" | KEEP | API-unavailable branches tested across feature adoption hooks |
| specs/features/customer-io-nurturing-integration.feature | "User login pushes last_active_at to Customer.io" | KEEP | activityTracking.unit.test.ts covers last_active_at on session callback |
| specs/features/customer-io-nurturing-integration.feature | "Activity tracking is debounced to avoid excessive API calls" | KEEP | One-call-per-hour debounce tested in activityTracking.unit.test.ts |
| specs/features/customer-io-nurturing-integration.feature | "Activity tracking failure does not break the login flow" | KEEP | API-unavailable branch tested in activityTracking.unit.test.ts |
| specs/features/customer-io-nurturing-integration.feature | "Product selection fires a separate identify call after flavour is picked" | UPDATE | Implemented as integration_method trait, not product_interest; rename scenario fields |
| specs/features/customer-io-nurturing-integration.feature | "Product interest is updated independently of signup flow" | UPDATE | Independence proven (no other traits resent) but trait renamed to integration_method |
| specs/features/customer-io-nurturing-integration.feature | "Flavour selection maps to correct product_interest trait value" | UPDATE | Mapping table differs (via-claude-code/coding_agent etc.); rewrite Examples to match mapProductSelectionToIntegrationMethod |
| specs/features/customer-io-nurturing-integration.feature | "Product interest identify call is fire-and-forget" | KEEP | Fire-and-forget verified in productInterest.unit.test.ts |
| specs/features/customer-io-nurturing-integration.feature | "Product interest identify failure does not break onboarding navigation" | KEEP | API-unavailable branch tested in productInterest.unit.test.ts |
| specs/features/customer-io-nurturing-integration.feature | "First prompt creation identifies user with has_prompts true" | KEEP | firePromptCreatedNurturing tests has_prompts true with prompt_count 1 |
| specs/features/customer-io-nurturing-integration.feature | "First prompt creation fires first_prompt_created event" | KEEP | first_prompt_created event tested in promptCreation.unit.test.ts |
| specs/features/customer-io-nurturing-integration.feature | "Subsequent prompt creation updates org-wide prompt_count without firing first event" | KEEP | Subsequent prompt branch tested in promptCreation.unit.test.ts |
| specs/features/customer-io-nurturing-integration.feature | "Prompt creation tracked regardless of whether created via platform UI or API" | KEEP | promptCreation.integration.test.ts covers REST API path with resolveOrgAdmin |
| specs/features/customer-io-nurturing-integration.feature | "Prompt creation hook failure does not break the prompt mutation" | KEEP | API-unavailable branch tested in promptCreation.unit.test.ts |
| specs/features/customer-io-nurturing-integration.feature | "First simulation run identifies user with has_simulations true" | KEEP | customerIoSimulationSync.reactor.unit.test.ts covers first-sim identify |
| specs/features/customer-io-nurturing-integration.feature | "First simulation run fires first_simulation_ran event" | KEEP | first_simulation_ran tracked in simulation sync reactor tests |
| specs/features/customer-io-nurturing-integration.feature | "First simulation fires immediately without debouncing" | KEEP | First-sim branch fires immediately in simulation sync reactor |
| specs/features/customer-io-nurturing-integration.feature | "Subsequent simulation runs update org-wide count and timestamp with debouncing" | KEEP | Subsequent simulation tests cover org-wide count + last_simulation_at |
| specs/features/customer-io-nurturing-integration.feature | "Simulation sync reactor uses project-scoped job ID for debouncing" | KEEP | makeJobId returns cio-sim-sync-{tenantId}; covered by reactor unit test |
| specs/features/customer-io-nurturing-integration.feature | "Simulation tracking is independent of scenario template creation" | KEEP | Reactor only fires on simulation pipeline events; scenario-create path not coupled |
| specs/features/customer-io-nurturing-integration.feature | "Signup defaults include has_prompts and has_simulations as false" | KEEP | Tested in signupIdentification.unit.test.ts (has_prompts/has_simulations false) |
| specs/features/customer-io-nurturing-integration.feature | "Attribution hook captures ref param in sessionStorage on first touch" | KEEP | useAttributionCapture.unit.test.ts covers ref capture |
| specs/features/customer-io-nurturing-integration.feature | "Attribution hook does not overwrite existing first-touch values" | KEEP | First-touch immutability tested in useAttributionCapture.unit.test.ts |
| specs/features/customer-io-nurturing-integration.feature | "Attribution hook captures full utm tuple when present in URL" | KEEP | utm_source/medium/campaign/term/content captures tested |
| specs/features/customer-io-nurturing-integration.feature | "Attribution hook captures document.referrer when present" | KEEP | document.referrer capture tested in useAttributionCapture.unit.test.ts |
| specs/features/customer-io-nurturing-integration.feature | "Signup with ref in URL sends lead_source trait and event property to Customer.io" | KEEP | leadSource->lead_source mapping tested in signupIdentification.unit.test.ts |
| specs/features/customer-io-nurturing-integration.feature | "Signup forwards utm tuple to Customer.io" | KEEP | utm tuple snake_case mapping tested in signupIdentification.unit.test.ts |
| specs/features/customer-io-nurturing-integration.feature | "Signup without attribution omits those fields from Customer.io traits" | KEEP | Empty-attribution branch tested in signupIdentification.unit.test.ts |
| specs/features/beta-pill.feature | "Beta pill badge renders with default message" | KEEP | BetaPill component + integration tests at langwatch/src/components/ui/__tests__/BetaPill.integration.test.tsx |
| specs/features/beta-pill.feature | "Beta pill badge renders with custom message" | KEEP | Custom-message hover popover tested in BetaPill.integration.test.tsx |
| specs/features/beta-pill.feature | "Popover renders styled text" | KEEP | Styled-text rendering tested in BetaPill.integration.test.tsx |
| specs/features/beta-pill.feature | "Popover renders clickable links" | KEEP | Clickable link inside popover tested in BetaPill.integration.test.tsx |
| specs/features/beta-pill.feature | "Keyboard focus shows the popover" | KEEP | Keyboard-focus popover test exists in BetaPill.integration.test.tsx |
| specs/features/beta-pill.feature | "Suites sidebar item displays a beta indicator" | KEEP | SideMenuLink consumes beta prop; sidebar usage exists, no integration test |
| specs/features/drawer-backdrop-transparency-blur.feature | "Drawer content panel applies blur filter and transparency" | KEEP | drawer.tsx applies backdropFilter blur(25px); test at drawer-backdrop.integration.test.tsx confirms render |
| specs/features/signup-slack-notifications.feature | "Slack notification sent after onboarding creates the organization" | KEEP | sendSlackSignupEvent in NotificationService tested in notification.service.unit.test.ts |
| specs/features/signup-slack-notifications.feature | "Slack notification includes optional campaign context when present" | KEEP | Phone+utm campaign included; covered in notification.service.unit.test.ts and onboarding integration test |
| specs/features/signup-slack-notifications.feature | "Missing optional signup fields do not block the notification" | KEEP | Baseline notification text path tested in notification.service.unit.test.ts |
| specs/features/signup-slack-notifications.feature | "Missing Slack webhook does not block onboarding completion" | KEEP | SLACK_CHANNEL_SIGNUPS-not-set branch tested in notification.service.unit.test.ts |
| specs/features/signup-slack-notifications.feature | "Slack delivery failure does not block onboarding completion" | KEEP | Webhook failure branch tested in notification.service.unit.test.ts |
| specs/features/onboarding/mcp-setup-prompt-compatibility.feature | "Pasting the tracing setup prompt does not crash Gemini CLI" | KEEP | Regression test at code-prompts.unit.test.ts iterates over all prompts including PROMPT_TRACING |
| specs/features/onboarding/mcp-setup-prompt-compatibility.feature | "Pasting the \"level up\" prompt does not crash Gemini CLI" | KEEP | PROMPT_LEVEL_UP covered in code-prompts.unit.test.ts describe.each block |
| specs/features/onboarding/mcp-setup-prompt-compatibility.feature | "Pasting the MCP config JSON does not crash Gemini CLI" | UPDATE | Regression test covers code prompts but not MCP JSON output of buildMcpJson; add JSON case |
| specs/features/onboarding/welcome-screens.feature | "Show welcome screen on first scenario creation" | KEEP | useNewScenarioFlow.unit.test.ts covers no-scenarios branch showing welcome modal |
| specs/features/onboarding/welcome-screens.feature | "Proceed from welcome screen to scenario creation" | KEEP | Proceed-from-welcome path tested in useNewScenarioFlow.unit.test.ts |
| specs/features/onboarding/welcome-screens.feature | "Skip welcome screen when scenarios already exist" | KEEP | Welcome-already-seen branch tested in useNewScenarioFlow.unit.test.ts |
| specs/features/onboarding/welcome-screens.feature | "Scenario welcome screen content" | KEEP | ScenarioWelcomeScreen.integration.test.tsx covers title, description, capabilities, CTA |
| specs/features/tag-management.feature | "Tags display as pills" | KEEP | TagPill component + TagList integration tests at langwatch/src/components/ui/__tests__/ |
| specs/features/tag-management.feature | "Tags can be removed" | KEEP | TagList onRemove tested in TagList.integration.test.tsx |
| specs/features/tag-management.feature | "Suite sidebar shows tags" | KEEP | SuiteSidebar.integration.test.tsx renders labels; no @scenario binding |
| specs/features/tag-management.feature | "Suite detail panel shows tags" | UPDATE | SuiteDetailPanel test asserts labels NOT displayed; behavior diverged from scenario |
| specs/features/tag-management.feature | "Scenario table shows tags" | KEEP | ScenarioTable.integration.test.tsx asserts labels-as-pills |
| specs/features/tag-management.feature | "An add button appears after existing tags" | KEEP | TagList renders + add button when onAdd provided; tested in TagList.integration.test.tsx |
| specs/features/tag-management.feature | "Clicking add button opens inline tag input" | KEEP | Inline input opens on +add click in TagList.integration.test.tsx |
| specs/features/trace-limit-upgrade-message.feature | "Free-tier org on SaaS told to upgrade with correct unit" | UPDATE | Tests assert "Free limit of 50000 events" but production limit-message.ts emits "Free plan limit of"; align |
| specs/features/trace-limit-upgrade-message.feature | "Free-tier org on self-hosted told to buy a license" | UPDATE | Production code says "get a license at" not "buy a license at"; rewrite scenarios to match implementation |
| specs/features/trace-limit-upgrade-message.feature | "Paid TIERED org on SaaS told to upgrade with traces unit" | UPDATE | Production prefix "Plan" vs scenario "Monthly"; usage.service tests assert "Monthly" so wording diverged |
| specs/features/trace-limit-upgrade-message.feature | "Paid TIERED org on self-hosted told to buy a license" | UPDATE | Same wording divergence ("buy a license" vs "get/upgrade a license") |
| specs/features/settings-plans-comparison.feature | "Member compares plans on the plans page" | KEEP | PlansComparisonPage.integration.test.tsx covers Free/Growth/Enterprise columns and current-plan badge |
| specs/features/settings-plans-comparison.feature | "Non-admin members can access plans comparison" | KEEP | Page is mounted at /settings/plans without admin guards; integration test renders for member |
| specs/features/settings-plans-comparison.feature | "Growth organizations see Growth as current" | KEEP | Growth-current branch tested in PlansComparisonPage.integration.test.tsx |
| specs/features/settings-plans-comparison.feature | "Legacy tier organizations show no current plan in comparison" | KEEP | Legacy-tier no-current-badge branch tested in PlansComparisonPage.integration.test.tsx |
| specs/features/settings-plans-comparison.feature | "TIERED organizations see a discontinued plan migration notice" | KEEP | Discontinued notice branch tested in PlansComparisonPage.integration.test.tsx |
| specs/features/settings-plans-comparison.feature | "Free plan column shows default limits" | UPDATE | FREE_PLAN_FEATURES is a string list, not the structured detail/value table from scenario; rewrite |
| specs/features/settings-plans-comparison.feature | "Growth plan column shows seat and usage pricing" | UPDATE | Growth seat/usage details rendered as feature strings; scenario detail/value table doesn't match |
| specs/features/settings-plans-comparison.feature | "Enterprise plan column shows custom commercial option" | UPDATE | Action label "Contact Sales" exists; highlights are strings not the structured table the scenario expects |
| specs/features/settings-plans-comparison.feature | "Plan details are visually comparable by row" | UPDATE | SimpleGrid renders columns but without explicit row-grouped "Usage" section the scenario describes |
| specs/features/stripe-price-catalog-sync.feature | "Sync task fetches Stripe prices for the detected key mode" | DELETE | No sync task script exists; only stripeCatalog.json + reader; sync code never landed |
| specs/features/stripe-price-catalog-sync.feature | "Sync task enforces required key mappings for current mode" | DELETE | No sync task implementation; aspirational |
| specs/features/stripe-price-catalog-sync.feature | "Sync task preserves the opposite mode mapping" | DELETE | No sync task implementation; aspirational |
| specs/features/stripe-price-catalog-sync.feature | "Billing runtime resolves live price ids in production" | KEEP | resolveStripePriceMap live-mode tested in stripePricesLoader.unit.test.ts |
| specs/features/stripe-price-catalog-sync.feature | "Billing runtime resolves test price ids outside production" | KEEP | resolveStripePriceMap test-mode tested in stripePricesLoader.unit.test.ts |
| specs/features/stripe-price-catalog-sync.feature | "Extra development prices do not break required mapping validation" | KEEP | Catalog parses extra non-required prices; required-only validation tested in stripePricesLoader.unit.test.ts |
| specs/features/subscription-service-refactor.feature | "New class implements the same interface as old factory" | UPDATE | EESubscriptionService implements SubscriptionService; old createSubscriptionService factory removed (no coexistence) |
| specs/features/subscription-service-refactor.feature | "EESubscriptionService updates subscription items via Stripe" | KEEP | updateSubscriptionItems tested in ee/billing/__tests__/subscription.service.unit.test.ts |
| specs/features/subscription-service-refactor.feature | "EESubscriptionService creates checkout for new subscription" | KEEP | createOrUpdateSubscription new-subscription branch tested |
| specs/features/subscription-service-refactor.feature | "EESubscriptionService cancels subscription when downgrading to free" | KEEP | FREE-plan cancel branch tested in subscription.service.unit.test.ts |
| specs/features/subscription-service-refactor.feature | "EESubscriptionService creates billing portal session" | KEEP | createBillingPortalSession tested in subscription.service.unit.test.ts |
| specs/features/subscription-service-refactor.feature | "EESubscriptionService notifies for prospective subscription" | KEEP | notifyProspective tested in subscription.service.unit.test.ts |
| specs/features/subscription-service-refactor.feature | "NullSubscriptionService throws on Stripe-dependent methods" | DELETE | No NullSubscriptionService class exists; only undefined fallback; aspirational |
| specs/features/subscription-service-refactor.feature | "NullSubscriptionService returns null for queries" | DELETE | Same — no NullSubscriptionService implementation in code |
| specs/features/subscription-service-refactor.feature | "Old factory remains unchanged" | DELETE | Refactor complete; old createSubscriptionService factory no longer exists in repo |
| specs/features/enterprise-feature-guards.feature | "Non-enterprise org cannot create custom roles" | DUPLICATE | Covered by enterprise-guards.integration.test.ts → role.create rejects with FORBIDDEN on free plan
| specs/features/enterprise-feature-guards.feature | "Enterprise org can create custom roles" | DUPLICATE | Covered by enterprise-guards.integration.test.ts → role.create allows creation on enterprise
| specs/features/enterprise-feature-guards.feature | "Non-enterprise org cannot update custom roles" | DUPLICATE | Covered by enterprise-guards.integration.test.ts → role.update rejects with FORBIDDEN on free plan
| specs/features/enterprise-feature-guards.feature | "Non-enterprise org cannot assign custom roles to users" | DUPLICATE | Covered by enterprise-guards.integration.test.ts → role.assignToUser rejects on free plan
| specs/features/enterprise-feature-guards.feature | "Non-enterprise org can remove custom roles from users" | DUPLICATE | Covered by enterprise-guards.integration.test.ts → role.removeFromUser allows removal on free plan
| specs/features/enterprise-feature-guards.feature | "Non-enterprise org can delete custom roles for cleanup" | DUPLICATE | Covered by enterprise-guards.integration.test.ts → role.delete allows deletion on free plan
| specs/features/enterprise-feature-guards.feature | "Non-enterprise org cannot assign custom roles via team update" | DUPLICATE | Covered by enterprise-guards.integration.test.ts → team.update rejects custom role on free plan
| specs/features/enterprise-feature-guards.feature | "Non-enterprise org can update team members with built-in roles" | DUPLICATE | Covered by enterprise-guards.integration.test.ts → team.update allows built-in role on free plan
| specs/features/enterprise-feature-guards.feature | "Non-enterprise org cannot assign custom roles via member role update" | DUPLICATE | Covered by enterprise-guards.integration.test.ts → organization.updateMemberRole rejects custom role
| specs/features/enterprise-feature-guards.feature | "Non-enterprise org cannot invite members with custom roles" | DUPLICATE | Covered by enterprise-guards.integration.test.ts → organization.createInvites rejects custom role
| specs/features/enterprise-feature-guards.feature | "Non-enterprise org can invite members with built-in roles" | DUPLICATE | Covered by enterprise-guards.integration.test.ts → createInvites allows built-in role on free plan
| specs/features/enterprise-feature-guards.feature | "Non-enterprise org cannot create teams with custom role members" | DUPLICATE | Covered by enterprise-guards.integration.test.ts → team.createTeamWithMembers rejects custom role
| specs/features/enterprise-feature-guards.feature | "Non-enterprise org cannot update team member role to custom role" | DUPLICATE | Covered by enterprise-guards.integration.test.ts → organization.updateTeamMemberRole rejects custom role
| specs/features/enterprise-feature-guards.feature | "Non-enterprise org cannot create invite requests with custom roles" | DUPLICATE | Covered by enterprise-guards.integration.test.ts → organization.createInviteRequest rejects custom role
| specs/features/enterprise-feature-guards.feature | "Batch invite rejects entirely when any invite has a custom role" | DUPLICATE | Covered by enterprise-guards.integration.test.ts → createInvites rejects entire batch
| specs/features/enterprise-feature-guards.feature | "Non-enterprise org cannot access audit logs" | DUPLICATE | Covered by enterprise-guards.integration.test.ts → organization.getAuditLogs rejects on free plan
| specs/features/enterprise-feature-guards.feature | "Enterprise org can access audit logs" | DUPLICATE | Covered by enterprise-guards.integration.test.ts → organization.getAuditLogs allows access on enterprise
| specs/features/enterprise-feature-guards.feature | "Enterprise plan from subscription is recognized" | DUPLICATE | Covered by enterprise.unit.test.ts → assertEnterprisePlan resolves for ENTERPRISE plan
| specs/features/enterprise-feature-guards.feature | "Enterprise plan from license is recognized" | DUPLICATE | Covered by enterprise.unit.test.ts → assertEnterprisePlan + composite-plan-provider license selection
| specs/features/enterprise-feature-guards.feature | "FREE plan is not recognized as enterprise" | DUPLICATE | Covered by enterprise.unit.test.ts → isEnterpriseTier returns false for FREE
| specs/features/enterprise-feature-guards.feature | "OPEN\_SOURCE plan is not recognized as enterprise" | DUPLICATE | Covered by enterprise.unit.test.ts → isEnterpriseTier returns false for OPEN_SOURCE
| specs/features/enterprise-feature-guards.feature | "Plan type matching is case-sensitive" | DUPLICATE | Covered by enterprise.unit.test.ts → isEnterpriseTier returns true only for exact "ENTERPRISE"
| specs/features/enterprise-feature-guards.feature | "Non-enterprise org can list custom roles" | KEEP | role.getAll lacks enterprise gate but no explicit unit asserts free plan listing succeeds
| specs/features/enterprise-feature-guards.feature | "Non-enterprise org can view a custom role" | KEEP | role.getById ungated; no unit test asserts free plan single-role lookup succeeds
| specs/features/enterprise-feature-guards.feature | "Invite with foreign custom role ID is rejected" | KEEP | invite.service validates customRole org but no test for foreign ID rejection
| specs/features/enterprise-feature-guards.feature | "Invite with valid custom role ID succeeds" | KEEP | invite.service path exists; no integration test asserts same-org custom role invite succeeds
| specs/features/enterprise-feature-guards.feature | "Guard fails closed when plan lookup fails" | DUPLICATE | Covered by enterprise.unit.test.ts and enterprise-guards.integration.test.ts → plan provider failure denies access
| specs/features/scim-group-mapping.feature | "Entra pushes a new group via SCIM" | KEEP | ScimGroupService.createGroup writes Group with scimSource="scim"; no service-level test
| specs/features/scim-group-mapping.feature | "Entra pushes a group that already exists" | KEEP | createGroup returns 409 on existing; no test
| specs/features/scim-group-mapping.feature | "Entra pushes members for a group with no RoleBindings" | KEEP | applyPatch + addMembers implements this; no test
| specs/features/scim-group-mapping.feature | "Entra pushes members for a group that has a RoleBinding" | KEEP | RBAC resolver implements inheritance; no SCIM-add-member-binding test
| specs/features/scim-group-mapping.feature | "Entra removes a member from a group" | KEEP | applyPatch remove implemented in scim-group.service.ts; no test
| specs/features/scim-group-mapping.feature | "Entra replaces full member list on a group" | KEEP | replaceGroup computes add/remove deltas; no test
| specs/features/scim-group-mapping.feature | "Entra deletes a SCIM group" | KEEP | deleteGroup cascades GroupMembership + RoleBinding; no test
| specs/features/scim-group-mapping.feature | "Admin lists all SCIM groups" | KEEP | group tRPC router supports listing but no UI/router test
| specs/features/scim-group-mapping.feature | "Admin adds a RoleBinding to a SCIM group" | KEEP | group.addBinding implemented in routers/group.ts; no test
| specs/features/scim-group-mapping.feature | "Admin removes a RoleBinding from a SCIM group" | KEEP | group.removeBinding implemented; no test
| specs/features/scim-group-mapping.feature | "Admin deletes a SCIM group" | KEEP | group.delete implemented in routers/group.ts; no test
| specs/features/scim-group-mapping.feature | "Non-enterprise org cannot access group management endpoints" | KEEP | group router uses enterprise guard; no integration test asserts FORBIDDEN on free
| specs/features/scim-group-mapping.feature | "Non-admin user cannot manage group bindings" | KEEP | group router has admin gate via RBAC; no test asserts MEMBER rejection
| specs/features/scim-group-mapping.feature | "User with multiple roles resolves to the most permissive" | DUPLICATE | Covered by scim-role-resolver.unit.test.ts → resolveHighestRole picks MEMBER over VIEWER
| specs/features/scim-group-mapping.feature | "Role hierarchy resolves ADMIN as most permissive" | DUPLICATE | Covered by scim-role-resolver.unit.test.ts → ADMIN beats MEMBER and all
| specs/features/scim-group-mapping.feature | "Removing a binding recalculates to remaining most permissive" | DUPLICATE | Covered by scim-role-resolver.unit.test.ts → recalculates after removal
| specs/features/scim-group-mapping.feature | "Role hierarchy ordering" | DUPLICATE | Covered by scim-role-resolver.unit.test.ts → hierarchy ordering tests
| specs/features/scim-group-mapping.feature | "Custom role is available when assigning a binding to a group" | KEEP | UI dropdown driven by role.getAll; no test asserts custom role appears in group binding dropdown
| specs/features/scim-group-mapping.feature | "Deprovisioned user's org membership and role bindings are cleaned up" | KEEP | scim.service deleteUser deactivates + cleans RoleBindings; no integration test for full deprovisioning
| specs/features/scim-group-mapping.feature | "Admin views SCIM groups table" | KEEP | settings/groups.tsx page exists; no UI integration test
| specs/features/scim-group-mapping.feature | "Admin sees member count per group" | KEEP | listGroups returns member counts; no UI test asserts display
| specs/features/scim-group-mapping.feature | "Admin assigns a RoleBinding to a group via the settings UI" | KEEP | GroupBindingInputRow implements assignment; no UI integration test
| specs/features/scim-group-mapping.feature | "Group member's access is resolved through standard RBAC" | KEEP | role-binding.service uses standard resolver; no test asserts SCIM-specific logic absent
| specs/features/scim-group-mapping.feature | "Org admin override applies for SCIM-managed group members" | KEEP | RBAC resolver applies ORG ADMIN override; no test for SCIM group member case
| specs/features/user-deactivation.feature | "Admin sees Deactivate button for an active user in the admin panel" | UPDATE | UsersView.tsx uses a Deactivated checkbox/badge in detail dialog, not a row-level "Deactivate button"
| specs/features/user-deactivation.feature | "Admin sees Reactivate button and Deactivated badge for a deactivated user" | UPDATE | UsersView shows Deactivated badge but no separate "Reactivate" button — toggle in detail dialog
| specs/features/user-deactivation.feature | "Admin deactivates a user via the admin panel" | UPDATE | UsersView calls user.update with deactivatedAt, not user.deactivate mutation as written
| specs/features/user-deactivation.feature | "Admin reactivates a deactivated user via the admin panel" | UPDATE | UsersView clears deactivatedAt via user.update; no separate user.reactivate mutation flow
| specs/features/user-deactivation.feature | "user.deactivate sets deactivatedAt on the user" | DUPLICATE | Covered by user.deactivation.unit.test.ts and user.service.unit.test.ts
| specs/features/user-deactivation.feature | "user.reactivate clears deactivatedAt on the user" | DUPLICATE | Covered by user.deactivation.unit.test.ts → reactivate clears deactivatedAt to null
| specs/features/user-deactivation.feature | "user.deactivate is rejected for non-admin callers" | KEEP | userRouter mutation exists but no unit test for non-admin FORBIDDEN
| specs/features/user-deactivation.feature | "user.reactivate is rejected for non-admin callers" | KEEP | userRouter mutation exists but no unit test for non-admin FORBIDDEN
| specs/features/user-deactivation.feature | "getAllOrganizationMembers excludes deactivated users" | KEEP | repository filter exists (deactivatedAt: null) but no explicit unit test
| specs/features/user-deactivation.feature | "getOrganizationWithMembersAndTheirTeams excludes deactivated users by default" | KEEP | repository filter exists; no explicit unit test
| specs/features/user-deactivation.feature | "TeamForm member dropdown omits deactivated users" | KEEP | TeamForm consumes filtered org members; no integration test for filtering
| specs/features/user-deactivation.feature | "AddParticipants dropdown omits deactivated users" | KEEP | AddParticipants consumes filtered org members; no integration test
| specs/features/user-deactivation.feature | "AddAnnotationQueueDrawer assignee dropdown omits deactivated users" | KEEP | AddAnnotationQueueDrawer consumes filtered members; no integration test
| specs/features/user-deactivation.feature | "Settings members list shows deactivated users with a Deactivated badge" | KEEP | settings/members.tsx renders badge with includeDeactivated:true; no integration test
| specs/features/user-deactivation.feature | "Deactivated user is blocked from signing in" | DUPLICATE | Covered by better-auth/hooks.test.ts → beforeUserCreate, beforeAccountCreate, beforeSessionCreate block deactivated users
| specs/features/user-deactivation.feature | "Active user is not blocked from signing in" | DUPLICATE | Covered by better-auth/hooks.test.ts → active user not blocked across hooks
| specs/features/pricing-model-aware-free-plan.feature | "TIERED organization on FREE plan gets 50,000 events per month" | DUPLICATE | Covered by ee/billing planProvider.unit.test.ts → TIERED no-subscription returns FREE 50k
| specs/features/pricing-model-aware-free-plan.feature | "SEAT_EVENT organization on FREE plan gets 50,000 events per month" | DUPLICATE | Covered by ee/billing planProvider.unit.test.ts → SEAT_EVENT no-subscription returns FREE 50k
| specs/features/pricing-model-aware-free-plan.feature | "Organization not found gets 50,000 events per month" | DUPLICATE | Covered by ee/billing planProvider.unit.test.ts → org not found returns FREE 50k
| specs/features/pricing-model-aware-free-plan.feature | "Custom subscription limits override the base free allowance" | DUPLICATE | Covered by ee/billing planProvider.unit.test.ts → unknown plan key with customLimits preserved
| specs/features/pricing-model-aware-free-plan.feature | "Valid subscription returns its own plan regardless of pricing model" | DUPLICATE | Covered by ee/billing planProvider.unit.test.ts → SEAT_EVENT with valid subscription does not query org
| specs/features/pricing-model-aware-free-plan.feature | "All pricing models get 50,000 events on the free tier" | DUPLICATE | Covered by ee/billing planProvider.unit.test.ts getFreePlanLimits + parametric pricing model coverage
| specs/features/pricing-model-aware-free-plan.feature | "Free TIERED organization counts each span toward the limit" | DUPLICATE | Covered by usage-meter-policy.unit.test.ts → free TIERED returns events meter
| specs/features/pricing-model-aware-free-plan.feature | "Free SEAT_EVENT organization counts each span toward the limit" | DUPLICATE | Covered by usage-meter-policy.unit.test.ts → free SEAT_EVENT returns events meter
| specs/features/pricing-model-aware-free-plan.feature | "Paid TIERED organization counts each trace as one unit" | DUPLICATE | Covered by usage-meter-policy.unit.test.ts → paid TIERED returns traces meter
| specs/features/pricing-model-aware-free-plan.feature | "Paid SEAT_EVENT organization counts each span toward the limit" | DUPLICATE | Covered by usage-meter-policy.unit.test.ts → paid SEAT_EVENT returns events meter
| specs/features/pricing-model-aware-free-plan.feature | "Licensed organization respects its own counting rule" | DUPLICATE | Covered by usage-service-getResolvedUsageUnit.unit.test.ts → license usageUnit overrides pricingModel
| specs/features/pricing-model-aware-free-plan.feature | "Self-hosted free organization is never blocked" | KEEP | usage.service self-hosted exceeded path tested for messaging but no explicit "ingestion not blocked" assertion
| specs/features/webhook-service-refactor.feature | "Successful checkout links and activates the subscription" | DUPLICATE | Covered by ee/billing webhookService.unit.test.ts → handleCheckoutCompleted activates and cancels trials
| specs/features/webhook-service-refactor.feature | "Checkout without a reference ID is ignored" | DUPLICATE | Covered by webhookService.unit.test.ts → "when client reference ID is missing returns early"
| specs/features/webhook-service-refactor.feature | "Checkout fails when no subscription matches the reference" | DUPLICATE | Covered by webhookService.unit.test.ts → SubscriptionRecordNotFoundError thrown
| specs/features/webhook-service-refactor.feature | "Checkout succeeds even when currency persistence fails" | DUPLICATE | Covered by webhookService.unit.test.ts → "continues when currency update fails"
| specs/features/webhook-service-refactor.feature | "Checkout succeeds even when invite approval fails" | DUPLICATE | Covered by webhookService.unit.test.ts → "continues when invite approval fails"
| specs/features/webhook-service-refactor.feature | "Checkout succeeds without an invite approval mechanism" | DUPLICATE | Covered by webhookService.unit.test.ts → "completes without invite approver"
| specs/features/webhook-service-refactor.feature | "First successful payment activates the subscription and clears a trial license" | DUPLICATE | Covered by webhookService.unit.test.ts handleInvoicePaymentSucceeded → activates and clears trial
| specs/features/webhook-service-refactor.feature | "Subsequent payment renewals do not re-notify" | DUPLICATE | Covered by webhookService.unit.test.ts → already active does not set startDate, no notify
| specs/features/webhook-service-refactor.feature | "Upgrade to a seat-event plan migrates old subscriptions" | DUPLICATE | Covered by webhookService.unit.test.ts → migrates tiered subscriptions and cancels old Stripe subs
| specs/features/webhook-service-refactor.feature | "Payment failure on an active subscription records the failure" | DUPLICATE | Covered by webhookService.unit.test.ts → ACTIVE keeps status with failed payment date
| specs/features/webhook-service-refactor.feature | "Payment failure on a pending subscription marks it as failed" | DUPLICATE | Covered by webhookService.unit.test.ts → PENDING sets status to FAILED
| specs/features/webhook-service-refactor.feature | "Subscription deletion cancels the subscription" | DUPLICATE | Covered by webhookService.unit.test.ts handleSubscriptionDeleted → waits for consistency, cancels
| specs/features/webhook-service-refactor.feature | "Subscription deletion is idempotent" | DUPLICATE | Covered by webhookService.unit.test.ts → "is idempotent — skips redundant update"
| specs/features/webhook-service-refactor.feature | "Subscription marked inactive or ended is cancelled" | DUPLICATE | Covered by webhookService.unit.test.ts handleSubscriptionUpdated → not active cancels
| specs/features/webhook-service-refactor.feature | "Subscription with ended_at is cancelled even if status is active" | DUPLICATE | Covered by webhookService.unit.test.ts → Stripe reports ended cancels
| specs/features/webhook-service-refactor.feature | "Scheduled cancellation does not cancel immediately" | DUPLICATE | Covered by webhookService.unit.test.ts → only canceled_at set updates quantities
| specs/features/webhook-service-refactor.feature | "Active subscription recalculates quantities from Stripe items" | DUPLICATE | Covered by webhookService.unit.test.ts → active recalculates quantities and updates
| specs/features/webhook-service-refactor.feature | "Active subscription update clears a trial license" | DUPLICATE | Covered by webhookService.unit.test.ts → active clears trial license on update
| specs/features/webhook-service-refactor.feature | "Transition to active triggers a notification" | DUPLICATE | Covered by webhookService.unit.test.ts → notifies when transitioning from non-active to active
| specs/features/webhook-service-refactor.feature | "Already-active subscription does not re-notify" | DUPLICATE | Covered by webhookService.unit.test.ts → skips notification when already active
| specs/features/webhook-service-refactor.feature | "Unrecognized subscription ID is ignored by <handler>" | DUPLICATE | Covered by webhookService.unit.test.ts → "when no subscription found skips without error" present in all 4 handlers
| specs/features/elasticsearch-write-disable-flags.feature | "Trace ingestion skips Elasticsearch when disabled" | DELETE | Flag column DROPPED in 20260403120000 migration; ClickHouse-only is now default
| specs/features/elasticsearch-write-disable-flags.feature | "Trace ingestion still writes to Elasticsearch when flag is off" | DELETE | ES trace writing fully disabled; "flag is off" path no longer exists
| specs/features/elasticsearch-write-disable-flags.feature | "Evaluation results skip Elasticsearch sync when disabled" | DELETE | disableElasticSearchEvaluationWriting column dropped; ClickHouse-only now
| specs/features/elasticsearch-write-disable-flags.feature | "Evaluation results still sync to Elasticsearch when flag is off" | DELETE | ES eval write path removed entirely
| specs/features/elasticsearch-write-disable-flags.feature | "Simulation events skip Elasticsearch when disabled" | DELETE | disableElasticSearchSimulationWriting column dropped
| specs/features/elasticsearch-write-disable-flags.feature | "Simulation events still write to Elasticsearch when flag is off" | DELETE | ES simulation write path removed entirely
| specs/features/elasticsearch-write-disable-flags.feature | "New flags default to false" | DELETE | All three columns no longer exist on Project
| specs/features/elasticsearch-write-disable-flags.feature | "Database migration adds the three new columns" | DELETE | Migration was added then reverted; columns no longer present
| specs/features/remove-dead-cost-checker-code.feature | "ICostChecker interface no longer exists" | DELETE | Cleanup completed in PR #2661; verified no ICostChecker references in src/
| specs/features/remove-dead-cost-checker-code.feature | "createCostChecker factory no longer exists" | DELETE | Cleanup completed in PR #2661; verified no createCostChecker references in src/
| specs/features/remove-dead-cost-checker-code.feature | "evaluationsWorker no longer performs cost check" | DELETE | Verified evaluationsWorker.ts has no costChecker references after PR #2661
| specs/features/remove-dead-cost-checker-code.feature | "EvaluationExecutionService no longer depends on CostChecker" | DELETE | Verified evaluation-execution.service.ts has no costChecker dependency
| specs/features/remove-dead-cost-checker-code.feature | "evaluate API route no longer performs cost check" | DELETE | Verified no costChecker in src/app/api after PR #2661 cleanup
| specs/features/remove-dead-cost-checker-code.feature | "topicClustering no longer performs cost check" | DELETE | Verified topicClustering.ts has no costChecker references
| specs/features/remove-dead-cost-checker-code.feature | "App presets no longer wire a costChecker into EvaluationExecutionService" | DELETE | Verified presets.ts has no costChecker wiring after PR #2661
| specs/features/remove-dead-cost-checker-code.feature | "getCurrentMonthCost remains available in the repository" | KEEP | Method preserved at license-enforcement.repository.ts:481; no explicit assertion test
| specs/features/remove-dead-cost-checker-code.feature | "UsageStatsService still reports current month cost on the dashboard" | KEEP | usage-stats.service still calls getCurrentMonthCost; no test asserts dashboard reports it
| specs/features/remove-dead-cost-checker-code.feature | "EvaluationExecutionService unit tests remove cost-limit scenarios" | DELETE | Cleanup-of-tests assertion already satisfied by PR #2661
| specs/features/remove-dead-cost-checker-code.feature | "topicClustering unit tests remove createCostChecker mock" | DELETE | Cleanup-of-tests assertion already satisfied by PR #2661
| specs/features/platform-evaluator-and-model-provider-tools.feature | "List all evaluators for a project" | KEEP | mcp-server/src/tools/list-evaluators.ts exists; integration test exists for tool but coverage of digest format unclear
| specs/features/platform-evaluator-and-model-provider-tools.feature | "Get evaluator details by ID or slug" | KEEP | mcp-server/src/tools/get-evaluator.ts exists; covered partially in evaluator-tools.unit.test.ts
| specs/features/platform-evaluator-and-model-provider-tools.feature | "Create a built-in evaluator" | KEEP | mcp-server/src/tools/create-evaluator.ts exists; behavior of generated ID/slug not explicitly asserted
| specs/features/platform-evaluator-and-model-provider-tools.feature | "Update an existing evaluator" | KEEP | mcp-server/src/tools/update-evaluator.ts exists; evaluatorType immutability assertion unclear
| specs/features/platform-evaluator-and-model-provider-tools.feature | "Discover evaluator types overview" | KEEP | mcp-server/src/tools/discover-evaluator-schema.ts exists; behavior partially in discover-evaluator-schema.unit.test.ts
| specs/features/platform-evaluator-and-model-provider-tools.feature | "Discover specific evaluator type details" | KEEP | discover-schema tool supports evaluatorType param; specific type detail flow not explicitly tested
| specs/features/platform-evaluator-and-model-provider-tools.feature | "PUT /api/evaluators/:id updates an evaluator" | DUPLICATE | Covered by evaluators-api.integration.test.ts (PUT /:id route exists in app.v1.ts)
| specs/features/platform-evaluator-and-model-provider-tools.feature | "DELETE /api/evaluators/:id archives an evaluator" | DUPLICATE | Covered by evaluators-api.integration.test.ts (DELETE /:id route in app.v1.ts archives via archivedAt)
| specs/features/platform-evaluator-and-model-provider-tools.feature | "List all model providers for a project" | KEEP | mcp-server/src/tools/list-model-providers.ts exists; masked-keys assertion not explicit in unit tests
| specs/features/platform-evaluator-and-model-provider-tools.feature | "Set or update a model provider" | KEEP | mcp-server/src/tools/set-model-provider.ts exists; key-never-returned assertion not in model-provider-tools.unit.test.ts
| specs/features/platform-evaluator-and-model-provider-tools.feature | "Update model provider without changing keys" | KEEP | set-model-provider supports partial updates; preserve-existing-keys behavior not asserted
| specs/features/platform-evaluator-and-model-provider-tools.feature | "GET /api/model-providers lists providers with masked keys" | DUPLICATE | Covered by model-providers-api.integration.test.ts (GET / route in app.v1.ts)
| specs/features/platform-evaluator-and-model-provider-tools.feature | "PUT /api/model-providers/:provider upserts provider config" | DUPLICATE | Covered by model-providers-api.integration.test.ts (PUT /:provider upsert route in app.v1.ts)
| specs/features/scenarios/workflow-agent-mapping-layer.feature | "Auto-computes mappings when workflow with conventional inputs is saved" | DUPLICATE | Bound by `auto-compute-agent-mappings.unit.test.ts` ("maps query to scenario input field" / "maps history to scenario messages field" / "sets scenarioOutputField to the first workflow output") |
| specs/features/scenarios/workflow-agent-mapping-layer.feature | "Skips auto-compute when workflow still has blank-template placeholder fields" | DUPLICATE | Bound by `auto-compute-agent-mappings.unit.test.ts` "skips auto-compute and leaves scenarioMappings empty" under blank-template describe |
| specs/features/scenarios/workflow-agent-mapping-layer.feature | "Re-computes mappings when existing mappings reference stale fields" | DUPLICATE | Bound by `auto-compute-agent-mappings.unit.test.ts` "re-computes mappings against the current workflow inputs" + companion stale-field tests |
| specs/features/scenarios/workflow-agent-mapping-layer.feature | "Auto-compute does not block the workflow save on failure" | DUPLICATE | Bound by `auto-compute-agent-mappings.unit.test.ts` "does not propagate the error (non-blocking)" under Prisma-throws describe |
| specs/features/scenarios/workflow-agent-mapping-layer.feature | "Opens mapping drawer when running a scenario with an unmapped workflow agent" | DUPLICATE | Bound by `ScenarioFormDrawer.mapping-gate.integration.test.tsx` "opens the AgentWorkflowEditorDrawer instead of starting the run" (no-mappings branch) |
| specs/features/scenarios/workflow-agent-mapping-layer.feature | "Opens mapping drawer when workflow agent has no input-field mapping" | DUPLICATE | Bound by `ScenarioFormDrawer.mapping-gate.integration.test.tsx` "opens the AgentWorkflowEditorDrawer instead of starting the run" (no-input-mapping branch) |
| specs/features/scenarios/workflow-agent-mapping-layer.feature | "Scenario runs successfully after user configures mappings via drawer" | KEEP | Drawer + Save&Run gate fully implemented (`ScenarioFormDrawer.tsx`, `AgentWorkflowEditorDrawer.tsx`); no e2e covering the post-config rerun flow |
| specs/features/scenarios/workflow-agent-mapping-layer.feature | "Returns actionable error for multi-input workflow agent without mappings" | DUPLICATE | Bound by `validate-workflow-mappings.unit.test.ts` "throws a BAD_REQUEST TRPCError with an actionable message" + actionable-message variants |
| specs/features/scenarios/workflow-agent-mapping-layer.feature | "Allows single-input workflow agent to run without explicit mappings" | DUPLICATE | Bound by `validate-workflow-mappings.unit.test.ts` "does not throw (legacy single-input fallback handles it)" |
| specs/features/scenarios/workflow-agent-mapping-layer.feature | "Create flow navigates directly to workflow studio without mapping panel" | KEEP | `WorkflowSelectorDrawer.tsx` navigates to studio after submit; no test asserts the no-mapping-panel invariant |
| specs/features/scenarios/workflow-agent-mapping-layer.feature | "Edit flow continues to show mapping panel as before" | KEEP | `AgentWorkflowEditorDrawer` + `ScenarioInputMappingSection` both present; behaviour not asserted in tests |
| specs/features/scenarios/workflow-agent-mapping-layer.feature | "Editing a workflow agent from the agents list opens the editor populated with existing data" | KEEP | `AgentListDrawer.tsx` opens `agentWorkflowEditor` with agentId; populated-state assertion not covered |
| specs/features/scenarios/workflow-agent-mapping-layer.feature | "Agents page routes each agent type to its matching editor drawer" | DUPLICATE | Bound by `getAgentEditorDrawer.unit.test.ts` per-type tests (code/http/workflow) |
| specs/features/scenarios/extensible-scenario-metadata.feature | "Custom metadata passes through from ingestion to read projection" | DUPLICATE | Bound by `extensible-metadata.integration.test.ts` "preserves custom metadata fields in run data" |
| specs/features/scenarios/extensible-scenario-metadata.feature | "Events with only name and description remain valid" | DUPLICATE | Bound by `extensible-metadata.integration.test.ts` "preserves the standard metadata fields" |
| specs/features/scenarios/extensible-scenario-metadata.feature | "Metadata under the langwatch namespace is preserved in projection" | DUPLICATE | Bound by `extensible-metadata.integration.test.ts` "preserves the langwatch namespace in metadata" |
| specs/features/scenarios/extensible-scenario-metadata.feature | "Event parsing preserves additional metadata fields" | DUPLICATE | Bound by `extensible-metadata.unit.test.ts` "preserves additional metadata fields" + discriminated-union variant |
| specs/features/scenarios/extensible-scenario-metadata.feature | "Event schema validates known fields and preserves custom metadata" | DUPLICATE | Bound by `extensible-metadata.unit.test.ts` schema-passthrough cases under scenarioRunStartedSchema |
| specs/features/scenarios/extensible-scenario-metadata.feature | "Storage transform preserves metadata key casing" | DUPLICATE | Bound by `extensible-metadata.unit.test.ts` "preserves metadata keys in their original casing" |
| specs/features/scenarios/extensible-scenario-metadata.feature | "Elasticsearch round-trip preserves metadata integrity" | DUPLICATE | Bound by `extensible-metadata.unit.test.ts` "preserves original metadata keys and values" |
| specs/features/scenarios/extensible-scenario-metadata.feature | "Elasticsearch mapping includes langwatch namespace fields" | DUPLICATE | Bound by `extensible-metadata.unit.test.ts` "is mapped as an object with dynamic keyword support" |
| specs/features/scenarios/extensible-scenario-metadata.feature | "User metadata fields are not explicitly mapped in Elasticsearch" | DUPLICATE | Bound by `extensible-metadata.unit.test.ts` "are not explicitly mapped outside langwatch namespace" |
| specs/features/scenarios/extensible-scenario-metadata.feature | "Langwatch namespace rejects incomplete platform metadata" | DUPLICATE | Bound by `extensible-metadata.unit.test.ts` "rejects the event" cases under missing-required-fields / invalid-targetType describes |
| specs/features/scenarios/extensible-scenario-metadata.feature | "Langwatch namespace is optional on metadata" | DUPLICATE | Bound by `extensible-metadata.unit.test.ts` "validates successfully" under langwatch-namespace-omitted describe |
| specs/features/scenarios/on-prem-hostname-validation.feature | "Scenario runner reaches a private hostname when IS_SAAS is false" | DUPLICATE | Bound by `ssrfProtection.unit.test.ts` "allows a private hostname" under isSaaS false describe |
| specs/features/scenarios/on-prem-hostname-validation.feature | "Scenario runner blocks a private hostname when IS_SAAS is true" | DUPLICATE | Bound by `ssrfProtection.unit.test.ts` "blocks a private hostname" under isSaaS true describe |
| specs/features/scenarios/on-prem-hostname-validation.feature | "Scenario runner allows self-signed certificates when IS_SAAS is false" | DUPLICATE | Bound by `ssrfProtection.unit.test.ts` "disables TLS certificate validation" via `createSSRFSafeFetchConfig({ isSaaS: false })` |
| specs/features/scenarios/on-prem-hostname-validation.feature | "Scenario runner enforces TLS certificates when IS_SAAS is true" | DUPLICATE | Bound by `ssrfProtection.unit.test.ts` "enables TLS certificate validation" via `createSSRFSafeFetchConfig({ isSaaS: true })` |
| specs/features/scenarios/on-prem-hostname-validation.feature | "Cloud metadata endpoints are blocked even when IS_SAAS is <saas_value>" | DUPLICATE | Bound by `ssrfProtection.unit.test.ts` "blocks cloud metadata endpoints" present under both isSaaS true and false describes |
| specs/features/scenarios/on-prem-hostname-validation.feature | "Cloud provider internal domains are blocked even when IS_SAAS is <saas_value>" | DUPLICATE | Bound by `ssrfProtection.unit.test.ts` "blocks cloud provider internal domains" present under both isSaaS describes |
| specs/features/scenarios/on-prem-hostname-validation.feature | "Private IP literals are allowed when IS_SAAS is false" | DUPLICATE | Bound by `ssrfProtection.unit.test.ts` "allows a private IP literal like 10.0.0.5" |
| specs/features/scenarios/on-prem-hostname-validation.feature | "Private IP literals are blocked when IS_SAAS is true" | DUPLICATE | Bound by `ssrfProtection.unit.test.ts` "blocks a private IP literal like 10.0.0.5" |
| specs/features/scenarios/run-view-side-by-side-layout.feature | "Clicking a run opens the detail drawer" | KEEP | `ScenarioRunDetailDrawer.tsx` registered in `drawerRegistry` and opened via row click; open behaviour not under explicit test |
| specs/features/scenarios/run-view-side-by-side-layout.feature | "Drawer header shows run identity and status" | DUPLICATE | Bound by `ScenarioRunDetailDrawer.integration.test.tsx` "displays the scenario name and status icon" + display-title variant |
| specs/features/scenarios/run-view-side-by-side-layout.feature | "Criteria section shows pass/fail summary" | DUPLICATE | Bound by `ScenarioRunDetailDrawer.integration.test.tsx` "displays the test report with criteria" (covers met/unmet via `SimulationConsole` + `CriteriaDetails`) |
| specs/features/scenarios/run-view-side-by-side-layout.feature | "Failed criteria show expandable reasoning" | KEEP | `CriteriaDetails.tsx` renders unmet criteria with reasoning via `SimulationConsole`; explicit expand interaction not tested |
| specs/features/scenarios/run-view-side-by-side-layout.feature | "Conversation section displays chat messages" | KEEP | Conversation rendered via `ScenarioMessageRenderer` in drawer; trace link via `setTraceDrawerTraceId`; no test asserts the View Trace link presence |
| specs/features/scenarios/run-view-side-by-side-layout.feature | "Drawer content scrolls when it overflows" | DELETE | Pure layout/CSS overflow concern (`overflowY="auto"` Drawer.Body) — not behavior worth a test |
| specs/features/scenarios/run-view-side-by-side-layout.feature | "Closing the drawer returns to the list view" | KEEP | Drawer wired to `closeDrawer()` and Drawer.CloseTrigger; behaviour valid but no integration test asserts close |
| specs/features/scenarios/workflow-agent-interpolation.feature | "All scenario-mapped and static variables interpolate into the LLM prompt" | DUPLICATE | Bound by `langwatch_nlp/tests/studio/test_workflow_agent_interpolation.py::test_str_inputs_interpolate` + TS adapter integration test "AC 1 — str-typed parrot test" |
| specs/features/scenarios/workflow-agent-interpolation.feature | "chat_messages-typed signature input runs without HTTP 500" | DUPLICATE | Bound by `workflow-agent.adapter.integration.test.ts` "runs repro-bug2 (chat_messages type) without HTTP 500 [AC 2]" + Python `test_parses_workflow_with_chat_messages_input` |
| specs/features/scenarios/workflow-agent-interpolation.feature | "Pre-existing str-typed workflows still function" | DUPLICATE | Bound by Python `test_str_inputs_interpolate` and TS adapter "AC 1" parrot-back integration test on `repro-bug1-str-type` fixture |
| specs/features/scenarios/workflow-agent-interpolation.feature | "A 2-turn scenario produces at least 2 distinct provider messages" | DUPLICATE | Bound by Python `test_multi_turn_history_produces_multiple_provider_messages` + `test_stringified_json_messages_do_not_leak_escaped_json` |
| specs/features/scenarios/workflow-agent-interpolation.feature | "A field type not present in FIELD_TYPE_TO_DSPY_TYPE produces a structured error" | DUPLICATE | Bound by Python `test_unknown_type_raises_actionable_error_not_undefined_error` under `TestUnmappedFieldTypeRaisesStructuredError` |
| specs/features/scenarios/workflow-agent-interpolation.feature | "Same template interpolates cleanly across Studio-exposed field types" | DUPLICATE | Bound by Python `test_signature_input_parses_for_every_studio_exposed_type` under `TestEveryStudioExposedTypeParses` (parametrized over all FieldType values) |
| specs/features/scenarios/unified-agent-target-section.feature | "SaveAndRunMenu shows agents in a single section" | KEEP | `SaveAndRunMenu.tsx` renders single "Run against Agent" section with HTTP/code/workflow icons; no integration test for the unified-section structure |
| specs/features/scenarios/unified-agent-target-section.feature | "TargetSelector shows agents in a single section" | KEEP | `TargetSelector.tsx` renders single "Agents" section with Globe/Code/Workflow icons + "Prompts" section below; behaviour not asserted in tests |
| specs/features/scenarios/unified-agent-target-section.feature | "Search filters across all agent types" | KEEP | `useFilteredAgents` filters by name across http/code/workflow; no test asserts cross-type search results in the menu |
| specs/features/scenarios/unified-agent-target-section.feature | "Selecting an agent preserves its type" | DUPLICATE | Bound by `RunScenarioModalTargetSelector.integration.test.tsx` "keeps the modal open and shows the selected agent" + initiate-run flow asserting target type/id |
| specs/features/scenarios/scenario-id-format.feature | "New scenario ID uses \"scenario_\" prefix with KSUID" | DUPLICATE | Bound by `simulation-runner.unit.test.ts` `generateScenarioId` cases asserting `scenario_` prefix and 38-char KSUID payload; also `KSUID_RESOURCES.SCENARIO = "scenario"` and `scenario.repository.ts` uses it |
| specs/features/scenarios/scenario-id-format.feature | "Command bar entity registry recognizes both prefixes" | DUPLICATE | Bound by `entityRegistry.unit.test.ts` "has an entry for the 'scenario_' prefix" + "has an entry for the legacy 'scen_' prefix" + lookup tests |
| specs/features/scenarios/scenario-id-format.feature | "Synthetic scenario run ID uses \"scenariorun_\" prefix with KSUID" | KEEP | `generateScenarioRunId()` in `scenario.ids.ts` + `KSUID_RESOURCES.SCENARIO_RUN = "scenariorun"`; no direct unit test asserts the prefix on the helper itself |
| specs/features/scenarios/scenario-run-status-config-location.feature | "Lucide-react icon mapping is colocated with the status config" | DUPLICATE | Bound by `scenario-run-status-config.unit.test.ts` "exports a lucide-react icon for every ScenarioRunStatus value" + valid-React-component check |
| specs/features/scenarios/scenario-run-status-config-location.feature | "Config covers every ScenarioRunStatus value" | DUPLICATE | Bound by `scenario-run-status-config.unit.test.ts` "covers every ScenarioRunStatus value" + parametrized "has colorPalette, label, isComplete, and fgColor" |
| specs/features/suites/rename-suites-to-runs.feature | "Sidebar displays \"Run Plans\" instead of \"Suites\"" | KEEP | featureIcons.ts has label "Run Plans"; no @e2e test bound yet |
| specs/features/suites/rename-suites-to-runs.feature | "Sidebar displays \"Run History\" instead of \"Runs\"" | KEEP | routes.ts/featureIcons.ts use the new wording but no @e2e covers the sidebar item |
| specs/features/suites/rename-suites-to-runs.feature | "Page header displays \"Run Plans\"" | KEEP | SimulationsPage uses Run Plans; no integration test asserts the heading |
| specs/features/suites/rename-suites-to-runs.feature | "Route title is \"Run Plans\"" | DUPLICATE | bound by langwatch/src/utils/__tests__/routes.unit.test.ts (@scenario JSDoc) |
| specs/features/suites/rename-suites-to-runs.feature | "Feature icon label for suites is \"Run Plans\"" | DUPLICATE | bound by langwatch/src/utils/__tests__/featureIcons.unit.test.ts (@scenario JSDoc) |
| specs/features/suites/rename-suites-to-runs.feature | "Route title for simulation runs is \"Run History\"" | KEEP | routes.ts has Run Plan/Run History titles but unit test only covers suites entry |
| specs/features/suites/rename-suites-to-runs.feature | "Feature icon label for simulation runs is \"Run History\"" | KEEP | featureIcons.ts label updated; no unit test for simulation-runs entry yet |
| specs/features/suites/rename-suites-to-runs.feature | "Form drawer title reads \"New Run Plan\" for creation" | DUPLICATE | covered by SuiteFormDrawer.integration.test.tsx "displays the 'New Run Plan' title" |
| specs/features/suites/rename-suites-to-runs.feature | "Form drawer title reads \"Edit Run Plan\" for editing" | DUPLICATE | covered by SuiteFormDrawer.integration.test.tsx "displays the Edit Run Plan title" |
| specs/features/suites/rename-suites-to-runs.feature | "Form placeholder uses \"Run Plan\" terminology" | DUPLICATE | SuiteFormDrawer.integration.test.tsx asserts placeholder "e.g., Critical Path Run Plan" |
| specs/features/suites/rename-suites-to-runs.feature | "Success toast after creating a run plan" | KEEP | SuiteFormDrawer toast title "Run plan created" exists; no test asserts it |
| specs/features/suites/rename-suites-to-runs.feature | "Success toast after updating a run plan" | KEEP | SuiteFormDrawer toast title "Run plan updated" exists; no integration test asserts it |
| specs/features/suites/rename-suites-to-runs.feature | "Success toast after archiving a run plan" | KEEP | SimulationsPage emits "Run plan archived" toast; no test asserts string |
| specs/features/suites/rename-suites-to-runs.feature | "Success toast after duplicating a run plan" | KEEP | SimulationsPage emits "Run plan duplicated" toast; no test asserts string |
| specs/features/suites/rename-suites-to-runs.feature | "Archive confirmation dialog uses \"run plan\"" | DUPLICATE | SuiteArchiveDialog.integration.test.tsx asserts "Archive run plan?" title |
| specs/features/suites/rename-suites-to-runs.feature | "Empty state when no run plans exist" | DUPLICATE | SuiteSidebar.integration.test.tsx asserts "No run plans yet" |
| specs/features/suites/rename-suites-to-runs.feature | "Empty state when search has no matches" | DUPLICATE | ExternalSetsSidebar.integration.test.tsx asserts "No matching run plans" |
| specs/features/suites/rename-suites-to-runs.feature | "Detail panel empty state" | KEEP | SuiteDetailPanel renders the strings; no integration test asserts both lines |
| specs/features/suites/rename-suites-to-runs.feature | "Detail panel empty state button" | DUPLICATE | SuiteUrlRouting.integration.test.tsx "displays New Run Plan button" |
| specs/features/suites/rename-suites-to-runs.feature | "Page header button reads \"New Run Plan\"" | KEEP | SimulationsPage renders "New Run Plan" button; no test asserts the suite list page header button text |
| specs/features/suites/cancel-queued-running-jobs.feature | "Cancel request produces a cancel_requested event" | DUPLICATE | bound via cancellation.unit.test.ts (@scenario for cancel-queued-running-jobs.feature) |
| specs/features/suites/cancel-queued-running-jobs.feature | "Fold projection sets CancellationRequestedAt without changing Status" | DUPLICATE | covered by simulationRunState.foldProjection.unit.test.ts cancel-event tests |
| specs/features/suites/cancel-queued-running-jobs.feature | "Cancel request is idempotent" | DUPLICATE | covered by foldProjection unit tests for cancel idempotence |
| specs/features/suites/cancel-queued-running-jobs.feature | "Cancel reactor broadcasts to Redis on cancel_requested event" | DUPLICATE | covered by cancellation-event-sourcing.integration.test.ts (@scenario binding) |
| specs/features/suites/cancel-queued-running-jobs.feature | "Worker kills its own child process on cancel broadcast" | DUPLICATE | covered by cancellation-channel.unit.test.ts and cancellation-event-sourcing integration |
| specs/features/suites/cancel-queued-running-jobs.feature | "Worker ignores cancel broadcast for scenarios it does not own" | DUPLICATE | covered by cancellation-channel.unit.test.ts ownership predicate tests |
| specs/features/suites/cancel-queued-running-jobs.feature | "Cancellation reaches a worker on a different pod" | KEEP | reactor publishes via Redis pub/sub; no integration test exercises cross-pod path |
| specs/features/suites/cancel-queued-running-jobs.feature | "Worker skips execution if cancel was already requested" | DUPLICATE | scenarioExecution.reactor checks CancellationRequestedAt; covered by event-sourcing integration test |
| specs/features/suites/cancel-queued-running-jobs.feature | "Cancelling a queued run writes both cancel and finished events" | DUPLICATE | cancellation.ts dispatches both events; covered by cancellation.unit.test.ts |
| specs/features/suites/cancel-queued-running-jobs.feature | "Batch cancel dispatches cancel events for all non-terminal runs" | DUPLICATE | cancellation-eligibility.unit.test.ts covers per-status filtering for batch cancel |
| specs/features/suites/cancel-queued-running-jobs.feature | "Batch cancel across multiple workers terminates all active runs" | KEEP | code path exists via reactor; no integration test exercises multi-worker batch flow |
| specs/features/suites/cancel-queued-running-jobs.feature | "User cancels a single running job from the run card" | DUPLICATE | covered by CancelButton.integration.test.tsx (@scenario binding) |
| specs/features/suites/cancel-queued-running-jobs.feature | "User cancels all remaining jobs for a batch run" | DUPLICATE | CancelButton.integration.test.tsx "when Cancel All button is clicked" |
| specs/features/suites/cancel-queued-running-jobs.feature | "Cancel button is hidden for jobs that already completed" | DUPLICATE | CancelButton.integration.test.tsx asserts hidden state for terminal status |
| specs/features/suites/cancel-queued-running-jobs.feature | "Cancellation does not overwrite terminal results" | DUPLICATE | foldProjection unit tests cover SUCCESS/FAILED/ERROR paths via Examples |
| specs/features/suites/cancel-queued-running-jobs.feature | "Late finish does not overwrite cancelled status" | DUPLICATE | foldProjection ordering tests cover late-finish-after-cancel path |
| specs/features/suites/unified-run-table.feature | "Queued jobs appear in the run table immediately after suite run" | KEEP | mergeRunData merges BullMQ + ES rows; no @e2e test exercises page UI |
| specs/features/suites/unified-run-table.feature | "Row status progresses from queued to running to completed" | KEEP | adaptive polling + status mapping exists; no @e2e covers full lifecycle |
| specs/features/suites/unified-run-table.feature | "Pass rate reflects total vs completed vs pending counts" | KEEP | RunMetricsSummary computes pass rate; no test asserts pending in count breakdown |
| specs/features/suites/unified-run-table.feature | "Service merges BullMQ jobs and ES scenario events into a unified list" | DUPLICATE | scenario-run-utils.unit.test.ts covers mergeRunData() merge case |
| specs/features/suites/unified-run-table.feature | "ES data takes precedence over BullMQ job data" | DUPLICATE | scenario-run-utils.unit.test.ts asserts ES wins on overlap |
| specs/features/suites/unified-run-table.feature | "Returns only ES data when no jobs are queued" | DUPLICATE | scenario-run-utils.unit.test.ts covers empty queuedRuns case |
| specs/features/suites/unified-run-table.feature | "Returns only queued rows when no ES events exist yet" | DUPLICATE | scenario-run-utils.unit.test.ts covers empty esRuns case |
| specs/features/suites/unified-run-table.feature | "All Runs view includes queued jobs across suites" | KEEP | AllRunsPanel uses unified data; no integration test asserts cross-suite queued rows |
| specs/features/suites/unified-run-table.feature | "Scheduled suite run stores scenario metadata needed for display" | KEEP | scheduling code stores metadata; no unit test inspects BullMQ job payload shape |
| specs/features/suites/unified-run-table.feature | "ScenarioJobRepository normalizes waiting jobs into row format" | KEEP | normalisation lives in scenario-run.utils; no dedicated repository abstraction or test exists |
| specs/features/suites/unified-run-table.feature | "Maps BullMQ job state to scenario run status" | KEEP | mapping logic exists inline; no Examples-driven unit test covers waiting/active mapping |
| specs/features/suites/unified-run-table.feature | "Deduplication removes BullMQ entries that have matching ES entries" | DUPLICATE | scenario-run-utils.unit.test.ts dedup case |
| specs/features/suites/unified-run-table.feature | "Queued rows render with a pending visual treatment" | KEEP | ScenarioTargetRow renders queued-spinner; no integration test asserts spinner+no-badge contract |
| specs/features/suites/unified-run-table.feature | "No separate pending banner is displayed" | DELETE | QueueStatusBanner component does not exist; banner concept superseded by unified table — assertion is vacuous |
| specs/features/suites/run-history-group-by.feature | "User groups suite results by target" | KEEP | group-by selector implemented in RunHistoryFilters; no @e2e covers full flow |
| specs/features/suites/run-history-group-by.feature | "Group-by selection persists in the URL" | KEEP | useRunHistoryStore reads groupBy URL param; no @e2e exercises reload |
| specs/features/suites/run-history-group-by.feature | "Group-by selector renders with correct options" | DUPLICATE | RunHistoryGroupBy.integration.test.tsx asserts ["None","Scenario","Target"] (@scenario binding) |
| specs/features/suites/run-history-group-by.feature | "Grouping by scenario re-groups results under scenario headers" | KEEP | grouping logic exists; no integration test asserts header pass rate + counts |
| specs/features/suites/run-history-group-by.feature | "Grouping by target re-groups results under target headers" | KEEP | target grouping implemented; no integration test asserts target header content |
| specs/features/suites/run-history-group-by.feature | "None grouping preserves current batch run layout" | KEEP | default groupBy=None preserves batch layout; no test asserts trigger type in header |
| specs/features/suites/run-history-group-by.feature | "Grouping by target respects active scenario filter" | KEEP | filters and grouping coexist; no integration test asserts the combined behaviour |
| specs/features/suites/run-history-group-by.feature | "Switching group-by mode preserves active filters" | KEEP | useRunHistoryStore keeps filters across groupBy changes; no test asserts persistence |
| specs/features/suites/run-history-group-by.feature | "Switching group-by mode collapses all groups" | KEEP | expansion state is per-group; no integration test asserts the collapse-on-switch behaviour |
| specs/features/suites/run-history-group-by.feature | "Every grouping mode returns groups with identifier, label, type, timestamp, and runs" | KEEP | run-history-transforms returns shape; no unit test enforces the contract across all modes |
| specs/features/suites/run-history-group-by.feature | "groupRunsByScenarioId groups runs by their scenarioId" | KEEP | grouping helper exists; no unit test covers scenario-id bucketing |
| specs/features/suites/run-history-group-by.feature | "groupRunsByTarget groups runs by their targetReferenceId" | KEEP | target grouping exists in transforms; no unit test for targetReferenceId bucketing |
| specs/features/suites/run-history-group-by.feature | "groupRunsByTarget places runs without target metadata in an \"Unknown\" group" | KEEP | code falls back to Unknown; no unit test covers missing-metadata bucket |
| specs/features/suites/run-history-group-by.feature | "Groups are sorted by most recent timestamp descending" | KEEP | grouping sort exists; no unit test asserts ordering |
| specs/features/suites/grid-view-and-borderless-tables.feature | "Filter bar shows a list/grid view toggle on suite detail" | DUPLICATE | ViewModeToggle.integration.test.tsx covers presence on suite detail (@scenario binding) |
| specs/features/suites/grid-view-and-borderless-tables.feature | "Filter bar shows a list/grid view toggle on all runs" | DUPLICATE | ViewModeToggle.integration.test.tsx covers all runs panel toggle |
| specs/features/suites/grid-view-and-borderless-tables.feature | "Switching to grid view shows scenario results as cards" | DUPLICATE | ScenarioGridCard.integration.test.tsx covers card rendering on grid view |
| specs/features/suites/grid-view-and-borderless-tables.feature | "Switching to list view shows scenario results as rows" | KEEP | list view exists as default; no integration test asserts toggle back to list rendering |
| specs/features/suites/grid-view-and-borderless-tables.feature | "View toggle preference persists within the session" | KEEP | useRunHistoryStore persists view mode; no @e2e exercises navigation persistence |
| specs/features/suites/grid-view-and-borderless-tables.feature | "Grid layout is responsive" | KEEP | CSS grid responsive; no integration test asserts viewport reflow |
| specs/features/suites/grid-view-and-borderless-tables.feature | "Run rows are expanded by default" | DUPLICATE | useAutoExpansion + AllRunsDefaultOpen.integration.test.tsx cover default-expansion |
| specs/features/suites/grid-view-and-borderless-tables.feature | "All runs panel rows are expanded by default" | DUPLICATE | AllRunsDefaultOpen.integration.test.tsx covers all-runs default expansion |
| specs/features/suites/grid-view-and-borderless-tables.feature | "Grid card shows scenario name, target, and iteration" | DUPLICATE | ScenarioGridCard.integration.test.tsx asserts card content fields |
| specs/features/suites/grid-view-and-borderless-tables.feature | "Run history rows span the full container width" | DUPLICATE | BorderlessTables.integration.test.tsx covers full-width rows |
| specs/features/suites/grid-view-and-borderless-tables.feature | "Run history rows have no rounded corners" | DUPLICATE | BorderlessTables.integration.test.tsx asserts borderRadius 0 |
| specs/features/suites/grid-view-and-borderless-tables.feature | "Run row headers are sticky when scrolling" | DUPLICATE | BorderlessTables.integration.test.tsx "has a sticky header with position sticky" |
| specs/features/suites/grid-view-and-borderless-tables.feature | "Expanded scenario rows span the full container width" | KEEP | borderless rows exist; no specific test asserts expanded-row full-width in list view |
| specs/features/suites/grid-view-and-borderless-tables.feature | "Expanded scenario rows have no outer border radius" | KEEP | borderRadius reset present; no test asserts expanded-row case specifically |
| specs/features/suites/real-time-run-updates.feature | "New run appears immediately in suite run history when SSE event fires" | KEEP | useSSESubscription wired in RunHistoryPanel; no integration test exercises onSimulationUpdate refetch path |
| specs/features/suites/real-time-run-updates.feature | "SSE events for a different suite do not trigger refetch" | KEEP | scenarioSetId filter present in subscription; no test asserts the no-refetch case |
| specs/features/suites/real-time-run-updates.feature | "New run appears immediately in All Runs when SSE event fires" | KEEP | AllRunsPanel mocks useSSESubscription in tests; no integration test asserts refetch + new row at top |
| specs/features/suites/real-time-run-updates.feature | "SSE subscription stays active after Load More in All Runs" | KEEP | subscription is mounted at panel level; no test asserts continuity through pagination |
| specs/features/suites/real-time-run-updates.feature | "Polling interval is fast when runs are in progress" | DUPLICATE | getAdaptivePollingInterval.unit.test.ts covers in-progress fast interval |
| specs/features/suites/real-time-run-updates.feature | "Polling interval is slow when all runs are settled" | DUPLICATE | getAdaptivePollingInterval.unit.test.ts covers all-settled slow interval |
| specs/features/suites/real-time-run-updates.feature | "Polling interval returns to fast when a new run starts" | DUPLICATE | getAdaptivePollingInterval.unit.test.ts covers transition back to fast |
| specs/features/suites/real-time-run-updates.feature | "All Runs polling interval is fast when any run is active" | DUPLICATE | getAdaptivePollingInterval is shared; covered by same unit test for active case |
| specs/features/suites/real-time-run-updates.feature | "All Runs polling interval is slow when all runs are settled" | DUPLICATE | getAdaptivePollingInterval unit test covers settled case for shared helper |
| specs/features/suites/real-time-run-updates.feature | "First SSE event triggers immediate refetch" | KEEP | debounceMs=500 set in panel; no unit test asserts immediate-then-debounce semantics |
| specs/features/suites/real-time-run-updates.feature | "Rapid SSE events are coalesced into a single refetch" | KEEP | debounce exists; no test asserts coalescing window of 500ms |
| specs/features/suites/real-time-run-updates.feature | "SSE events are ignored when the browser tab is hidden" | KEEP | usePageVisibility hook exists but RunHistoryList does not gate refetch on it; partially implemented |
| specs/features/suites/real-time-run-updates.feature | "Pending updates are applied when the tab becomes visible again" | KEEP | usePageVisibility hook exists; not yet wired into RunHistoryList refetch |
| specs/features/suites/suite-list-view-status.feature | "Successful run shows \"passed\" with criteria count" | DUPLICATE | formatRunStatusLabel.unit.test.ts covers passed-with-count case (@scenario binding) |
| specs/features/suites/suite-list-view-status.feature | "Failed run shows \"failed\" with criteria count" | DUPLICATE | formatRunStatusLabel.unit.test.ts covers failed-with-count case |
| specs/features/suites/suite-list-view-status.feature | "Run with no criteria results shows status without count" | DUPLICATE | formatRunStatusLabel.unit.test.ts covers no-evaluation-results case |
| specs/features/suites/suite-list-view-status.feature | "Run with zero criteria shows status without count" | KEEP | formatRunStatusLabel handles 0/0 implicitly; no specific unit test asserts the zero-criteria branch |
| specs/features/suites/suite-list-view-status.feature | "In-progress run shows \"running\" without criteria count" | DUPLICATE | formatRunStatusLabel.unit.test.ts "returns 'running' without criteria count" |
| specs/features/suites/suite-list-view-status.feature | "Pending run shows \"pending\" without criteria count" | DUPLICATE | formatRunStatusLabel.unit.test.ts "returns 'pending' without criteria count" |
| specs/features/suites/suite-list-view-status.feature | "List view row displays passed status with criteria count" | DUPLICATE | ScenarioTargetRow.integration.test.tsx asserts passed with criteria count for SUCCESS |
| specs/features/suites/suite-list-view-status.feature | "List view row displays failed status with criteria count" | DUPLICATE | ScenarioTargetRow.integration.test.tsx asserts failed with criteria count for ERROR |
| specs/features/suites/suite-list-view-status.feature | "List view row with iteration shows iteration number in title" | KEEP | run-history-transforms appends "(#N)" to title; no integration test asserts the iteration suffix |
| specs/features/suites/suite-list-view-status.feature | "Suite detail panel list view uses the same status format" | KEEP | format helper is shared; no panel-level integration test asserts consistency |
| specs/features/suites/suite-list-view-status.feature | "All runs panel list view uses the same status format" | KEEP | shared helper used in both; no all-runs integration test asserts consistency |
| specs/features/suites/external-sdk-ci-sets-in-sidebar.feature | "External sets section appears with SDK-submitted scenario runs" | DUPLICATE | ExternalSetsSidebar.integration.test.tsx asserts external-sets-header rendered when externalSets present |
| specs/features/suites/external-sdk-ci-sets-in-sidebar.feature | "Clicking an external set opens the batch view" | KEEP | SuiteSidebar links external sets to /simulations/{scenarioSetId}; no @e2e exercises navigation |
| specs/features/suites/external-sdk-ci-sets-in-sidebar.feature | "External set entry shows pass rate and recency" | DUPLICATE | ExternalSetsSidebar.integration.test.tsx covers pass count + recency rendering |
| specs/features/suites/external-sdk-ci-sets-in-sidebar.feature | "External set shows correct status indicator" | DUPLICATE | ExternalSetsSidebar.integration.test.tsx covers checkmark/error status icon cases |
| specs/features/suites/external-sdk-ci-sets-in-sidebar.feature | "External set uses scenarioSetId as its display name" | DUPLICATE | SuiteSidebar renders scenarioSetId; covered by ExternalSetsSidebar integration test |
| specs/features/suites/external-sdk-ci-sets-in-sidebar.feature | "External set batch view is read-only" | KEEP | ExternalSetDetailPanel exists; no integration test asserts the absence of Run/Edit/Run-Again actions |
| specs/features/suites/external-sdk-ci-sets-in-sidebar.feature | "Search filters across both Suites and External Sets" | KEEP | SuiteSidebar filters externalSets by query; no integration test asserts cross-section search |
| specs/features/suites/external-sdk-ci-sets-in-sidebar.feature | "Search with no matches hides both sections" | KEEP | SuiteSidebar hides sections when both empty; no test asserts the no-match hide behaviour |
| specs/features/suites/external-sdk-ci-sets-in-sidebar.feature | "External Sets section is hidden when no external sets exist" | DUPLICATE | ExternalSetsSidebar.integration.test.tsx asserts header not in document when empty |
| specs/features/suites/external-sdk-ci-sets-in-sidebar.feature | "Sets associated with a platform suite do not appear in External Sets" | KEEP | exclusion happens server-side via association lookup; no integration test asserts exclusion behaviour |
| specs/features/suites/external-sdk-ci-sets-in-sidebar.feature | "External sets are ordered by most recent run" | KEEP | externalSets sorted by lastRunTimestamp; no test asserts ordering |
| specs/features/suites/unified-run-view-layout.feature | "External set view shows group-by and list/grid toggle" | KEEP | ExternalSetDetailPanel + RunHistoryFilters render group-by/view toggle (#2038); no e2e test bound |
| specs/features/suites/unified-run-view-layout.feature | "All run views provide the same layout controls" | KEEP | RunHistoryFilters shared across suite/all-runs/external panels; no e2e test bound |
| specs/features/suites/unified-run-view-layout.feature | "External set group-by selector omits target option" | KEEP | availableGroupByOptions({viewContext:"external"}) covered in UnifiedRunViewLayout test, not bound via @scenario |
| specs/features/suites/unified-run-view-layout.feature | "Suite detail group-by selector includes target option" | KEEP | groupByOptions includes "Target" for suite context; behavior in UnifiedRunViewLayout test |
| specs/features/suites/unified-run-view-layout.feature | "All runs group-by selector includes all options" | KEEP | All runs panel shares same RunHistoryFilters, all options rendered |
| specs/features/suites/unified-run-view-layout.feature | "Grouping by scenario in external set groups runs under scenario headers" | KEEP | RunHistoryGroupBy test covers scenario grouping; external set uses same grouping |
| specs/features/suites/unified-run-view-layout.feature | "External set supports list and grid view modes" | KEEP | ViewModeToggle test covers list/grid; ExternalSetDetailPanel uses RunHistoryFilters |
| specs/features/suites/unified-run-view-layout.feature | "Each view shows scenario filter, status filter, group-by, and view toggle" | KEEP | RunHistoryFilters renders all 4 controls; shared across views |
| specs/features/suites/unified-run-view-layout.feature | "View mode selection carries over between views" | KEEP | View mode persisted via store; behavior implied by useRunHistoryStore |
| specs/features/suites/unified-run-view-layout.feature | "External set with group-by None shows batch run grouping" | KEEP | None-group falls back to batch grouping in transforms |
| specs/features/suites/suite-url-routing.feature | "Selecting a suite updates the URL to include the suite slug" | UPDATE | Routing is path-based (/run-plans/suite-a) not query (?suite=) — feature wording diverged from #2946 |
| specs/features/suites/suite-url-routing.feature | "Selecting \"All Runs\" removes the suite query param" | UPDATE | Path-based routing means selection clears path segments, not query param |
| specs/features/suites/suite-url-routing.feature | "Navigating directly to a suite URL opens that suite" | UPDATE | URL pattern is path-based; SuiteUrlRouting test asserts /run-plans/:slug not ?suite= |
| specs/features/suites/suite-url-routing.feature | "Navigating to base suites URL shows all runs view" | UPDATE | Base path is /simulations not /simulations/suites; covered with diverged URL |
| specs/features/suites/suite-url-routing.feature | "Navigating to a non-existent suite slug shows empty state" | UPDATE | Behavior covered in test but URL pattern diverged |
| specs/features/suites/suite-url-routing.feature | "Archiving the current suite navigates to base path" | KEEP | archive mutation in SimulationsPage navigates to ALL_RUNS; no @scenario binding |
| specs/features/suites/suite-url-routing.feature | "Browser back button returns to previous suite" | KEEP | Native browser back works with shallow routing; no e2e test bound |
| specs/features/suites/suite-url-routing.feature | "Browser forward button navigates to next suite" | KEEP | Same as back — native history nav works with shallow routing |
| specs/features/suites/suite-url-routing.feature | "User shares a direct link to a suite" | UPDATE | URL format diverged; share-link flow works but path differs from spec |
| specs/features/suites/suite-sidebar-status-summary.feature | "Suite item shows pass count and time since last run" | KEEP | SuiteSidebar renders status icon + pass count + recency; SuiteSidebar test covers it |
| specs/features/suites/suite-sidebar-status-summary.feature | "Suite item shows partial pass count with failure icon" | KEEP | StatusIcon switches on pass/fail; behavior in SuiteSidebar test |
| specs/features/suites/suite-sidebar-status-summary.feature | "Suite item with no runs shows no summary" | KEEP | Conditional render of summary line for empty suites |
| specs/features/suites/suite-sidebar-status-summary.feature | "\"All Runs\" item does not show a status summary" | KEEP | All Runs item is rendered without summary section |
| specs/features/suites/suite-sidebar-status-summary.feature | "Summary reflects latest run data" | KEEP | tRPC subscription updates summary; covered indirectly in SuiteSidebar test |
| specs/features/suites/suite-sidebar-status-summary.feature | "Three-dot menu button appears on hover" | KEEP | SuiteSidebar test "shows a three-dot menu button" line 488 |
| specs/features/suites/suite-sidebar-status-summary.feature | "Three-dot menu button is hidden when not hovering" | KEEP | SuiteSidebar test line 503 covers hidden-on-no-hover via opacity |
| specs/features/suites/suite-sidebar-status-summary.feature | "Clicking three-dot menu opens context menu" | KEEP | SuiteContextMenu shows Edit/Duplicate/Delete; covered in SuiteContextMenu test |
| specs/features/suites/suite-sidebar-status-summary.feature | "Context menu stays open after mouse leaves suite item" | KEEP | Chakra Menu portal stays open until outside-click; default Menu behavior |
| specs/features/suites/inline-add-target-and-scenario-buttons.feature | "Adding a target via the inline button" | KEEP | TargetPicker.onAddTarget triggers AgentHttpEditorDrawer (#2039); no e2e bound |
| specs/features/suites/inline-add-target-and-scenario-buttons.feature | "Adding a scenario via the inline button" | KEEP | ScenarioPicker has inline Add Scenario button; covered in ScenarioPicker test line 133 |
| specs/features/suites/inline-add-target-and-scenario-buttons.feature | "Add Target button replaces bottom sidebar buttons" | KEEP | Sidebar bottom buttons removed; Add Target moved inline (#2039) |
| specs/features/suites/inline-add-target-and-scenario-buttons.feature | "Add Target button uses an icon" | KEEP | TargetPicker line 86 renders plus icon button |
| specs/features/suites/inline-add-target-and-scenario-buttons.feature | "Add Scenario button is inline with the scenario search" | KEEP | ScenarioPicker has inline button with plus icon |
| specs/features/suites/inline-add-target-and-scenario-buttons.feature | "Add Target drawer opens as a child drawer, not via navigation" | KEEP | SuiteFormDrawer test line 542 verifies child-drawer pattern (#1962) |
| specs/features/suites/inline-add-target-and-scenario-buttons.feature | "Add Scenario drawer opens as a child drawer, not via navigation" | KEEP | SuiteFormDrawer test line 495 verifies scenario editor child drawer |
| specs/features/suites/inline-add-target-and-scenario-buttons.feature | "Add Target drawer reuses the existing target drawer component" | KEEP | AgentHttpEditorDrawer reused (same component as evals area) |
| specs/features/suites/footer-to-header-migration.feature | "Run row header displays summary counts alongside existing info" | KEEP | RunRow uses RunSummaryCounts; covered in RunRow.integration.test.tsx (#2027) |
| specs/features/suites/footer-to-header-migration.feature | "Run row no longer renders a summary footer whether expanded or collapsed" | KEEP | Footer removed in #2027; assertion covered in RunRow test |
| specs/features/suites/footer-to-header-migration.feature | "Group row header additionally displays passed and failed counts" | KEEP | GroupRow shows counts in header; GroupRow.integration test covers it |
| specs/features/suites/footer-to-header-migration.feature | "Group row no longer renders a summary footer whether expanded or collapsed" | KEEP | Group row footer removed in #2027 |
| specs/features/suites/footer-to-header-migration.feature | "Stalled and cancelled counts appear only when non-zero (per-row only)" | KEEP | RunSummaryCounts conditionally renders stalled/cancelled (lines 77-92) |
| specs/features/suites/footer-to-header-migration.feature | "Stalled and cancelled counts are hidden when zero" | KEEP | Same conditional render hides zero counts; RunSummaryCounts test covers |
| specs/features/suites/footer-to-header-migration.feature | "Run history list shows aggregate totals in table header" | KEEP | RunMetricsSummary in suite detail panel header |
| specs/features/suites/footer-to-header-migration.feature | "All runs panel shows aggregate totals in table header" | KEEP | All runs panel uses same RunMetricsSummary |
| specs/features/suites/unified-sidebar-list-items.feature | "External set item displays the same information as a suite item" | KEEP | ExternalSetsSidebar test covers shared rendering (#2281) |
| specs/features/suites/unified-sidebar-list-items.feature | "External set item does not show a Run button" | KEEP | ExternalSetItem omits Run button by design |
| specs/features/suites/unified-sidebar-list-items.feature | "Suite item shows a Run button" | KEEP | SuiteItem renders Run button; SuiteSidebar test covers it |
| specs/features/suites/unified-sidebar-list-items.feature | "External set item does not show a three-dot context menu on hover" | KEEP | ExternalSetItem omits context menu |
| specs/features/suites/unified-sidebar-list-items.feature | "Suite item shows a three-dot context menu on hover" | KEEP | Covered in SuiteSidebar test line 488 |
| specs/features/suites/unified-sidebar-list-items.feature | "External set list item displays pass count and recency using shared building blocks" | KEEP | StatusIcon + RunSummaryLine shared; ExternalSetsSidebar test covers it |
| specs/features/suites/unified-sidebar-list-items.feature | "External set list item displays no summary when there are no runs" | KEEP | Conditional summary in shared component |
| specs/features/suites/suite-runs-time-filter.feature | "User filters All Runs by a preset time range" | KEEP | PeriodSelector wired in SimulationsPage (line 322) (#1827); no e2e test bound |
| specs/features/suites/suite-runs-time-filter.feature | "Time filter updates displayed runs when period changes" | KEEP | Period state propagates to history queries via startDate/endDate |
| specs/features/suites/suite-runs-time-filter.feature | "Suite detail panel filters runs by selected time range" | KEEP | Period passed to suite history query |
| specs/features/suites/suite-runs-time-filter.feature | "Changing the time filter resets pagination" | KEEP | Period dependency in pagination hook resets cursor |
| specs/features/suites/suite-runs-time-filter.feature | "Selected date range limits displayed run data" | DUPLICATE | Covered by usePeriodSelector.unit.test.ts |
| specs/features/suites/suite-runs-time-filter.feature | "Batch runs are included or excluded atomically" | KEEP | run-history-transforms groups runs by batch; behavior implicit |
| specs/features/suites/suite-runs-time-filter.feature | "Default time range is applied on initial load" | DUPLICATE | usePeriodSelector(30) default covered in usePeriodSelector.unit.test.ts |
| specs/features/suites/target-selector-select-clear-all.feature | "Target picker displays Select All and Clear buttons" | DUPLICATE | TargetPicker.unit.test.tsx covers footer Select All / Clear (#1970) |
| specs/features/suites/target-selector-select-clear-all.feature | "Clicking Select All selects all targets" | DUPLICATE | TargetPicker test calls onSelectAll (line 273) |
| specs/features/suites/target-selector-select-clear-all.feature | "Clicking Clear deselects all targets" | DUPLICATE | TargetPicker test covers Clear button |
| specs/features/suites/target-selector-select-clear-all.feature | "Select All adds to partial selection" | KEEP | TargetPicker.onSelectAll selects all; behavior in component |
| specs/features/suites/target-selector-select-clear-all.feature | "Select All applies to visible filtered targets" | KEEP | Filtered selection logic in TargetPicker; not directly bound |
| specs/features/suites/target-selector-select-clear-all.feature | "Clear removes every selected target regardless of filter" | KEEP | Clear acts on full selection regardless of filter |
| specs/features/suites/suite-run-confirmation-modal.feature | "Confirmation modal appears when clicking Run" | UPDATE | Dialog title is suite name with body "Run X simulations?", not literal "Run suite?" (#2025) |
| specs/features/suites/suite-run-confirmation-modal.feature | "Modal displays execution summary with estimated job count" | KEEP | Dialog shows scenarios, targets, estimated jobs (scenarioCount * targetCount * repeatCount) |
| specs/features/suites/suite-run-confirmation-modal.feature | "Confirming the modal triggers the suite run" | KEEP | onConfirm fires; covered in SuiteRunConfirmationDialog test |
| specs/features/suites/suite-run-confirmation-modal.feature | "Cancelling the modal does not trigger a run" | KEEP | onClose without onConfirm; standard Dialog behavior |
| specs/features/suites/suite-run-confirmation-modal.feature | "Buttons are disabled while run is being scheduled" | KEEP | isLoading prop disables buttons (line 46-47) |
| specs/features/suites/suite-run-confirmation-modal.feature | "Modal closes and error toast appears when run fails" | KEEP | useRunSuite triggers toast on failure; modal closes on settled |
| specs/features/suites/collapsible-suite-sidebar.feature | "Sidebar is expanded by default" | KEEP | SuiteSidebar isCollapsed defaults from localStorage; expanded by default |
| specs/features/suites/collapsible-suite-sidebar.feature | "Clicking the collapse button collapses the sidebar" | KEEP | toggleCollapsed in SuiteSidebar (line 83); width changes |
| specs/features/suites/collapsible-suite-sidebar.feature | "Clicking the expand button expands the sidebar" | KEEP | Same toggle inverts state |
| specs/features/suites/collapsible-suite-sidebar.feature | "All Runs action is accessible when collapsed" | KEEP | All Runs button rendered with isCollapsed icon-only mode (line 134) |
| specs/features/suites/collapsible-suite-sidebar.feature | "Clicking a suite icon when collapsed navigates to that suite" | KEEP | Suite items remain clickable when collapsed |
| specs/features/suites/collapsible-suite-sidebar.feature | "Collapse state persists across page navigations" | KEEP | SUITE_SIDEBAR_COLLAPSED_KEY localStorage persistence (line 44) |
| specs/features/suites/suite-bugfixes-1956.feature | "Clicking a run in external set detail opens the drawer" | DUPLICATE | Shipped in PR #1974 (cbc866af8); behavior covered by ExternalSetDetailPanel.integration.test.tsx |
| specs/features/suites/suite-bugfixes-1956.feature | "Run rows in All Runs panel span the full available width" | DUPLICATE | Shipped in PR #1974; layout covered by BorderlessTables.integration.test.tsx and AllRunsPanel.integration.test.tsx |
| specs/features/suites/suite-bugfixes-1956.feature | "Quick run from drawer navigates to runs page via URL with drawer params" | DUPLICATE | Shipped in PR #1974 (callbacks); covered by SuiteUrlRouting.integration.test.tsx + RunHistoryPanel run flow tests |
| specs/features/suites/suite-bugfixes-1956.feature | "Quick run failure shows toast with drawer link instead of page link" | DUPLICATE | Shipped in PR #1974; toast/drawer linkage covered by RunHistoryPanel + SuiteUrlRouting integration tests |
| specs/features/suites/suite-bugfixes-1956.feature | "Run Again from standalone run page stays on the standalone page" | DUPLICATE | Regression guard for shipped #1974; covered by SuiteUrlRouting + ScenarioRunContent integration tests |
| specs/features/suites/run-scenario-target-selector-modal-stability.feature | "Selecting a prompt keeps the modal open" | DUPLICATE | Bound to RunScenarioModalTargetSelector.integration.test.tsx (file-level @see), shipped in PR #2137 |
| specs/features/suites/run-scenario-target-selector-modal-stability.feature | "Selecting an agent keeps the modal open" | DUPLICATE | Covered by RunScenarioModalTargetSelector.integration.test.tsx "when selecting an agent" describe block |
| specs/features/suites/run-scenario-target-selector-modal-stability.feature | "Clicking outside the dropdown closes only the dropdown" | DUPLICATE | Covered by RunScenarioModalTargetSelector.integration.test.tsx "when clicking inside the modal but outside the dropdown" |
| specs/features/suites/run-scenario-target-selector-modal-stability.feature | "Clicking outside the modal still closes the modal" | KEEP | Behavior shipped in #2137 but no explicit test for outside-modal click; would be a useful regression guard |
| specs/features/suites/run-scenario-target-selector-modal-stability.feature | "Completing the full run flow after selecting a target" | DUPLICATE | Covered by RunScenarioModalTargetSelector.integration.test.tsx "when completing the full run flow" |
| specs/features/suites/all-runs-scenario-names.feature | "Run row displays scenario names in the collapsed header" | KEEP | RunRow.integration.test.tsx tests pass-rate/expansion but not scenario-name string in collapsed header |
| specs/features/suites/all-runs-scenario-names.feature | "Run row displays single scenario name without separator" | KEEP | Single-name formatting not asserted in current RunRow tests |
| specs/features/suites/all-runs-scenario-names.feature | "Run row truncates long scenario name lists" | KEEP | Truncation "+N more" formatting not asserted in current tests |
| specs/features/suites/all-runs-scenario-names.feature | "Extracts unique sorted scenario names from batch run data" | KEEP | run-history-transforms.unit.test.ts exists but does not cover unique-sort scenario-name extraction helper |
| specs/features/suites/all-runs-scenario-names.feature | "Falls back to scenario ID when name is null or undefined" | KEEP | Null/undefined fallback not asserted in run-history-transforms.unit.test.ts |
| specs/features/suites/suite-url-nesting.feature | "Suite route path is nested under simulations" | UPDATE | Shipped (#2946 path-based URLs) but URL is now /simulations/run-plans/:slug not /simulations/suites; scenario expectations diverged |
| specs/features/suites/suite-url-nesting.feature | "Navigation link points to the new suite URL" | UPDATE | Sidebar link points to /simulations not /simulations/suites after #2320 rename to Run Plans |
| specs/features/suites/suite-url-nesting.feature | "Only Suites is active in sidebar when viewing suites page" | UPDATE | Menu item renamed to "Run Plans" / "Run History" per #2320; "Suites menu item" wording stale |
| specs/features/suites/suite-url-nesting.feature | "User navigates to suites via simulations menu" | UPDATE | Path/label diverged after #2320 + #2946; SuiteUrlRouting.integration.test.tsx covers current behavior |
| specs/features/suites/suite-archive-confirmation-dialog.feature | "Archive confirmation dialog appears when archiving a suite" | DUPLICATE | Shipped in PR #1848; SuiteArchiveDialog.integration.test.tsx asserts title and dialog content (note: title is now "Archive run plan?") |
| specs/features/suites/suite-archive-confirmation-dialog.feature | "Cancel dismisses the archive confirmation dialog without archiving" | DUPLICATE | SuiteArchiveDialog.integration.test.tsx "when Cancel is clicked" covers onClose + no onConfirm |
| specs/features/suites/suite-archive-confirmation-dialog.feature | "Confirm archives the suite" | DUPLICATE | SuiteArchiveDialog.integration.test.tsx "when Archive is clicked" covers onConfirm |
| specs/features/suites/suite-archive-confirmation-dialog.feature | "Buttons are disabled while archive is in progress" | DUPLICATE | SuiteArchiveDialog.integration.test.tsx "when isLoading is true" disables Cancel + Archive |
| specs/features/suites/nested-drawer-typing.feature | "User types in a nested drawer opened from the suite editor" | DUPLICATE | Shipped in PR #2037; NestedDrawerTyping.integration.test.tsx covers keyboard input in nested ScenarioFormDrawer |
| specs/features/suites/nested-drawer-typing.feature | "Focus moves to the nested drawer when it opens" | KEEP | NestedDrawerTyping covers typing but not explicit focus-transfer assertion |
| specs/features/suites/nested-drawer-typing.feature | "Typing works in the parent drawer after closing a nested drawer" | KEEP | Parent-drawer-typing-after-close not asserted in NestedDrawerTyping.integration.test.tsx |
| specs/features/suites/nested-drawer-typing.feature | "Command bar does not intercept typing in a nested drawer" | KEEP | Command-bar interception regression not asserted in current test suite |
| specs/features/suites/all-runs-group-by.feature | "User groups All Runs results by scenario" | DUPLICATE | Shipped in PR #1969 + #2038; AllRunsPanel.integration.test.tsx "group-by selector" suite covers Scenario grouping |
| specs/features/suites/all-runs-group-by.feature | "All Runs page displays group-by selector with correct options and default" | DUPLICATE | AllRunsPanel.integration.test.tsx "renders group-by selector with None selected by default" + "has None, Scenario, and Target options" |
| specs/features/suites/all-runs-group-by.feature | "None grouping on All Runs preserves batch run layout" | DUPLICATE | RunHistoryGroupBy.integration.test.tsx + AllRunsPanel cover None default rendering batch rows |
| specs/features/suites/all-runs-group-by.feature | "Grouped results include runs from all suites" | DUPLICATE | AllRunsPanel.integration.test.tsx "includes runs from multiple suites in grouped results" |
| specs/features/suites/suite-empty-state.feature | "Empty state displays when suite has no runs" | DUPLICATE | Shipped in PR #2026; RunHistoryEmptyState.integration.test.tsx "given a suite with no runs" |
| specs/features/suites/suite-empty-state.feature | "Empty state disappears when runs exist" | DUPLICATE | RunHistoryEmptyState.integration.test.tsx "given a suite with at least one run" |
| specs/features/suites/suite-empty-state.feature | "Empty state does not appear when runs exist but are filtered out" | DUPLICATE | RunHistoryEmptyState.integration.test.tsx "given a suite with runs outside the selected time period" |
| specs/features/suites/single-loading-indicator.feature | "Sidebar shows skeleton placeholders while loading" | DUPLICATE | Shipped in PR #1907; SuitesPageLoading.integration.test.tsx "displays skeleton placeholder rows in the sidebar" + "does not show a spinner" |
| specs/features/suites/single-loading-indicator.feature | "Main panel content is hidden while the page is still loading" | DUPLICATE | SuitesPageLoading.integration.test.tsx covers main-panel render gating during load |
| specs/features/suites/single-loading-indicator.feature | "Main panel shows its own loading indicator after sidebar is ready" | DUPLICATE | SuitesPageLoading.integration.test.tsx "when main panel data is still loading" describe block |
| specs/features/suites/remove-label-tag-pills.feature | "Suite sidebar cards do not display label tag pills" | DELETE | Cleanup shipped in PR #2387; no TagPill in suites components, label removal complete |
| specs/features/suites/remove-label-tag-pills.feature | "Suite detail panel header does not display label tag pills" | DELETE | Removed in #2387; SuiteDetailPanel has no label-pill rendering |
| specs/features/suites/remove-label-tag-pills.feature | "Suite edit form does not display labels field" | DELETE | Labels field removed from SuiteFormDrawer in #2387 (only data-model `labels` remains) |
| specs/features/suites/all-runs-panel.feature | "Pre-suite scenario runs appear in All Runs" | DUPLICATE | Shipped in #1979 (unify pending+completed); covered by AllRunsPanel.integration.test.tsx run-aggregation tests |
| specs/features/suites/all-runs-panel.feature | "Suite-created runs still appear in All Runs" | DUPLICATE | Shipped in #1979; AllRunsPanel.integration.test.tsx "given runs exist" covers suite-pattern runs |
| specs/features/suites/all-runs-panel.feature | "All run types appear together" | DUPLICATE | Shipped in #1979; AllRunsPanel.integration.test.tsx "includes runs from multiple suites" covers combined types |
| specs/features/suites/all-runs-batch-origin-label.feature | "Suite batch entry displays the suite name" | DUPLICATE | Shipped in PR #2036; BatchSection.integration.test.tsx asserts batch sub-header rendering with suite context |
| specs/features/suites/all-runs-batch-origin-label.feature | "External set batch entry displays the set name" | DUPLICATE | Shipped in #2036; ExternalSetsSidebar/ExternalSetDetailPanel integration tests cover external-set labelling |
| specs/features/suites/all-runs-batch-origin-label.feature | "Batch entry without a known set shows no origin label" | KEEP | Negative case "no origin label" not asserted in current BatchSection or AllRunsPanel tests |
| specs/features/suites/remove-redundant-suites-label.feature | "Sidebar does not display a redundant SUITES label" | DUPLICATE | Cleanup shipped in PR #2013; SuitesPageLayout.integration.test.tsx "does not render a 'SUITES' section header in the sidebar" |
| specs/features/suites/remove-redundant-suites-label.feature | "Sidebar still shows suite names and action buttons after label removal" | DUPLICATE | SuiteSidebar.integration.test.tsx "displays all suite names" + search/run/context tests cover post-removal sidebar |
| specs/features/suites/all-runs-default-open.feature | "All Runs is selected when page loads" | DUPLICATE | Bound to AllRunsDefaultOpen.integration.test.tsx (file-level @see); covers default selection on load |
| specs/features/suites/all-runs-default-open.feature | "All Runs is selected after deleting the current suite" | DUPLICATE | AllRunsDefaultOpen.integration.test.tsx "when the user archives the selected suite" covers post-archive navigation |
| specs/features/prompts/custom-prompt-tags.feature | "Only \"latest\" is a protected tag" | DUPLICATE | PROTECTED_TAGS = ["latest"] in prompt-tag.repository.ts; covered by prompt-tag.repository.unit.test.ts "when name is a protected tag" |
| specs/features/prompts/custom-prompt-tags.feature | "Validation rejects creating a tag named \"latest\"" | DUPLICATE | prompt-tag.repository.unit.test.ts asserts protected-tag rejection for each PROTECTED_TAGS value |
| specs/features/prompts/custom-prompt-tags.feature | "Validation accepts \"production\" as a tag name" | DUPLICATE | prompt-tag.repository.unit.test.ts "does not throw for 'production' (seeded tag, not protected)" |
| specs/features/prompts/custom-prompt-tags.feature | "Validation accepts \"staging\" as a tag name" | DUPLICATE | prompt-tag.repository.unit.test.ts "does not throw for 'staging'" (SEEDED_TAGS const includes staging) |
| specs/features/prompts/custom-prompt-tags.feature | "Deleting the seeded \"production\" tag succeeds" | DUPLICATE | api/prompts/__tests__/prompt-tags.integration.test.ts DELETE returns 204 for existing custom tag (production seeded as regular tag) |
| specs/features/prompts/custom-prompt-tags.feature | "Deleting the seeded \"staging\" tag succeeds" | DUPLICATE | Same DELETE 204 flow in api/prompts/prompt-tags.integration.test.ts; staging behaves identically to production seeded tag |
| specs/features/prompts/custom-prompt-tags.feature | "Recreating \"production\" after deletion succeeds" | DUPLICATE | POST 201 path covered by api/prompts/prompt-tags.integration.test.ts "when creating a valid custom tag" applies to recreation |
| specs/features/prompts/custom-prompt-tags.feature | "Assigning a tag that exists in the DB succeeds" | DUPLICATE | server/prompt-config/prompt-tags.integration.test.ts "when assigning a tag to a specific version" |
| specs/features/prompts/custom-prompt-tags.feature | "Assigning a tag that was deleted fails" | KEEP | Assignment-after-deletion negative path not asserted in prompt-tags.integration.test.ts (validation against missing DB tag) |
| specs/features/prompts/custom-prompt-tags.feature | "Assigning a recreated tag succeeds" | DUPLICATE | Reassignment behavior covered by "when reassigning a tag to a different version" + recreation flow |
| specs/features/prompts/custom-prompt-tags.feature | "Creating a custom tag" | DUPLICATE | api/prompts/prompt-tags.integration.test.ts "when creating a valid custom tag" returns 201 with id and name |
| specs/features/prompts/custom-prompt-tags.feature | "Deleting a custom tag cascades to assignments" | DUPLICATE | api/prompts/prompt-tags.integration.test.ts "when deleting a tag with assignments" cascades to remove PromptTagAssignment rows |
| specs/features/prompts/custom-prompt-tags.feature | "Creating a duplicate tag returns 409" | DUPLICATE | api/prompts/prompt-tags.integration.test.ts "when name already exists in the org" returns 409 conflict |
| specs/features/prompts/custom-prompt-tags.feature | "Creating \"latest\" via the API returns 422" | DUPLICATE | api/prompts/prompt-tags.integration.test.ts "when name clashes with a protected tag" returns 422 mentioning protected for 'latest' |
| specs/features/prompts/custom-prompt-tags.feature | "New org gets \"production\" and \"staging\" seeded" | DUPLICATE | organization.service.ts seeds SEEDED_TAGS on creation; covered indirectly by integration tests that rely on seeded prod/staging |
| specs/features/prompts/custom-prompt-tags.feature | "Validation rejects empty tag names" | DUPLICATE | prompt-tag.repository.unit.test.ts "when name is empty" throws PromptTagValidationError |
| specs/features/prompts/custom-prompt-tags.feature | "Validation rejects purely numeric tag names" | DUPLICATE | prompt-tag.repository.unit.test.ts "when name is purely numeric" throws with message mentioning numeric |
| specs/features/prompts/custom-prompt-tags.feature | "Validation rejects uppercase tag names" | DUPLICATE | prompt-tag.repository.unit.test.ts "throws for uppercase names" |
| specs/features/prompts/custom-prompt-tags.feature | "Validation accepts well-formed custom tag names" | DUPLICATE | prompt-tag.repository.unit.test.ts "when name is a valid custom tag" suite covers canary/ab-test/my_tag/v2 |
| specs/features/prompts/custom-prompt-tags.feature | "Full lifecycle of a custom tag" | DUPLICATE | Full CRUD + assign/cascade lifecycle covered across api/prompts/prompt-tags.integration.test.ts and server/prompt-config/prompt-tags.integration.test.ts |
| specs/features/prompts/custom-prompt-tags.feature | "Delete and recreate a seeded tag" | DUPLICATE | DELETE + POST + reassign flow covered by api/prompts/prompt-tags.integration.test.ts and prompt-tags.integration.test.ts assignment suites |
| specs/features/devtools/worktree-creation.feature | "Derives slug from issue title" | KEEP | scripts/worktree.sh generate_slug() implemented, covered by worktree.unit.bats but no @scenario binding |
| specs/features/devtools/worktree-creation.feature | "Truncates slug to 40 characters at word boundary" | UPDATE | Implementation truncates at 50 chars (max_len=50), spec says 40 — feature/code disagree |
| specs/features/devtools/worktree-creation.feature | "Strips special characters from slug" | KEEP | scripts/worktree.sh strips non-alphanumeric, covered by worktree.unit.bats |
| specs/features/devtools/worktree-creation.feature | "Builds branch name from issue number" | KEEP | scripts/worktree.sh build_branch_name() implemented, covered by worktree.unit.bats |
| specs/features/devtools/worktree-creation.feature | "Builds branch name from feature name" | KEEP | scripts/worktree.sh build_branch_name() handles feat/ prefix, covered by worktree.unit.bats |
| specs/features/devtools/worktree-creation.feature | "Derives directory name from issue branch" | KEEP | scripts/worktree.sh derive_directory() implemented, covered by worktree.unit.bats |
| specs/features/devtools/worktree-creation.feature | "Derives directory name from feature branch" | KEEP | scripts/worktree.sh derive_directory() implemented, covered by worktree.unit.bats |
| specs/features/devtools/worktree-creation.feature | "Creates worktree from issue number" | KEEP | scripts/worktree.sh main() implemented, covered by worktree.integration.bats |
| specs/features/devtools/worktree-creation.feature | "Creates worktree from feature name" | KEEP | scripts/worktree.sh implemented, covered by worktree.integration.bats |
| specs/features/devtools/worktree-creation.feature | "Checks out existing remote branch" | KEEP | scripts/worktree.sh git ls-remote check, covered by worktree.integration.bats |
| specs/features/devtools/worktree-creation.feature | "Copies all .env files to new worktree" | KEEP | scripts/worktree.sh copies subdirectory .env*, covered by worktree.integration.bats |
| specs/features/devtools/worktree-creation.feature | "Warns when .env files are missing from main checkout" | KEEP | scripts/worktree.sh prints warnings, no integration test asserts warning text |
| specs/features/devtools/worktree-creation.feature | "Exits when worktree directory already exists" | KEEP | scripts/worktree.sh exits non-zero, covered by worktree.integration.bats |
| specs/features/devtools/worktree-creation.feature | "Installs dependencies and prints summary with issue URL" | KEEP | scripts/worktree.sh runs pnpm install + prints URL, covered by worktree.integration.bats |
| specs/features/devtools/worktree-creation.feature | "Prints summary without issue URL for feature worktrees" | KEEP | scripts/worktree.sh skips issue URL for feat/, covered by worktree.integration.bats |
| specs/features/devtools/worktree-creation.feature | "Fails gracefully when gh CLI is not available for issue input" | KEEP | scripts/worktree.sh checks command -v gh, covered by worktree.integration.bats |
| specs/features/devtools/worktree-creation.feature | "Fails when no argument is provided" | KEEP | scripts/worktree.sh exits with usage message, covered by worktree.integration.bats |
| specs/features/devtools/worktree-creation.feature | "Fetches from origin before creating worktree" | KEEP | scripts/worktree.sh runs git fetch origin, covered by worktree.integration.bats |
| specs/features/devtools/orchestrator-bug-fix-workflow.feature | "Detects bug by GitHub label" | KEEP | orchestrate skill SKILL.md classifies by label first, no automated test |
| specs/features/devtools/orchestrator-bug-fix-workflow.feature | "Detects bug by title keyword \"fix\"" | KEEP | orchestrate skill SKILL.md classifies by title keywords (fix/bug/broken/crash) |
| specs/features/devtools/orchestrator-bug-fix-workflow.feature | "Detects bug by title keyword \"bug\"" | KEEP | orchestrate skill SKILL.md classifies by bug keyword |
| specs/features/devtools/orchestrator-bug-fix-workflow.feature | "Detects bug by title keyword \"broken\"" | KEEP | orchestrate skill SKILL.md classifies by broken keyword |
| specs/features/devtools/orchestrator-bug-fix-workflow.feature | "Does not classify feature requests as bugs" | KEEP | orchestrate skill SKILL.md uses enhancement label, no automated test |
| specs/features/devtools/orchestrator-bug-fix-workflow.feature | "Detects bug by issue template" | DELETE | orchestrate skill no longer references issue templates; classifies by label/title only |
| specs/features/devtools/orchestrator-bug-fix-workflow.feature | "Bug-fix workflow skips plan creation" | UPDATE | Skill diverged: /fix-bug now requires plan + feature file from /orchestrate readiness gate, not skipped |
| specs/features/devtools/orchestrator-bug-fix-workflow.feature | "Bug-fix workflow skips challenge step" | UPDATE | Workflow restructured; /challenge is part of /investigate for proposals, not orchestrate |
| specs/features/devtools/orchestrator-bug-fix-workflow.feature | "Bug-fix workflow skips user approval" | DELETE | No "user approval step" exists in current orchestrate/fix-bug skills |
| specs/features/devtools/orchestrator-bug-fix-workflow.feature | "Bug-fix workflow skips test review" | DELETE | No "test review step" gating in current orchestrate/fix-bug skills |
| specs/features/devtools/orchestrator-bug-fix-workflow.feature | "Bug-fix workflow skips E2E generation" | DELETE | No "E2E verification step" exists in current orchestrate/fix-bug skills |
| specs/features/devtools/orchestrator-bug-fix-workflow.feature | "Bug-fix workflow runs investigation step" | UPDATE | /fix-bug now requires investigation as part of readiness gate, not as an internal step |
| specs/features/devtools/orchestrator-bug-fix-workflow.feature | "Bug-fix workflow runs fix step" | KEEP | /fix-bug SKILL.md delegates "minimal fix" to /code per task |
| specs/features/devtools/orchestrator-bug-fix-workflow.feature | "Bug-fix workflow requires a regression test" | KEEP | /fix-bug SKILL.md mandates regression test must fail first then pass |
| specs/features/devtools/orchestrator-bug-fix-workflow.feature | "Bug-fix workflow runs verification" | UPDATE | /fix-bug runs tests per pass; typecheck happens via gates not in fix loop |
| specs/features/devtools/orchestrator-bug-fix-workflow.feature | "Bug-fix workflow runs review" | KEEP | orchestrate SKILL.md runs /review gate after convergence completes |
| specs/features/devtools/orchestrator-bug-fix-workflow.feature | "Feature issues still use the full workflow" | UPDATE | Workflow is now /deliver-work loop; "approval" and "test review" steps removed |
| specs/features/devtools/issue-creation-skill.feature | "Confirms detected type before creating issue" | DELETE | /create-issue no longer asks user to confirm type; classifies silently then iterates on ACs |
| specs/features/devtools/issue-creation-skill.feature | "Creates bug issue with template body sections" | DELETE | /create-issue no longer uses bug-report.md template with Describe/Reproduce/Expected sections |
| specs/features/devtools/issue-creation-skill.feature | "Creates feature request with template body sections" | DELETE | /create-issue body is Summary + Acceptance Criteria, not Problem/Proposed/Alternatives |
| specs/features/devtools/issue-creation-skill.feature | "Creates chore with template body sections" | DELETE | CHORE type and chore.md template removed; only bug/feature/refactor classifications exist |
| specs/features/devtools/issue-creation-skill.feature | "Assigns issue to current GitHub user" | KEEP | /create-issue SKILL.md uses --assignee @me with verification check |
| specs/features/devtools/issue-creation-skill.feature | "Adds issue to LangWatch Kanban project with default status" | KEEP | /create-issue SKILL.md mandates `gh project item-add 5` with Backlog default |
| specs/features/devtools/issue-creation-skill.feature | "Sets optional project fields when user specifies them" | DELETE | Skill no longer accepts priority/size args directly; iterates via ACs phase |
| specs/features/devtools/issue-creation-skill.feature | "Sets Epic project field when user specifies an epic category" | DELETE | EPIC field setting via skill args removed; refer users to langwatch-kanban skill |
| specs/features/devtools/issue-creation-skill.feature | "Links issue as sub-issue of parent epic" | DELETE | /create-issue does not handle sub-issue linking; that lives in github skill |
| specs/features/devtools/issue-creation-skill.feature | "Skips sub-issue linking when no parent epic specified" | DELETE | Sub-issue linking is not part of /create-issue at all |
| specs/features/devtools/issue-creation-skill.feature | "Offers to launch implementation after creation" | UPDATE | Skill now asks about /investigate (not /implement) after Phase 1.5 ACs iteration |
| specs/features/devtools/issue-creation-skill.feature | "Shows usage instructions when invoked with no arguments" | KEEP | /create-issue Phase 0 asks user for repo if no slug, no automated test |
| specs/features/devtools/issue-creation-skill.feature | "Shows authentication error when not logged in" | KEEP | gh CLI auth failure surfaces naturally, no skill-specific test |
| specs/features/devtools/issue-creation-skill.feature | "Shows access error when project is unreachable" | KEEP | Phase 1 verification step catches project item-add failure |
| specs/features/devtools/bullboard-queue-dashboard.feature | "bullboard server starts and connects to Redis" | KEEP | bullboard/src/server.ts implements Redis connect + PORT 6380, no automated test |
| specs/features/devtools/bullboard-queue-dashboard.feature | "bullboard server fails gracefully without Redis" | KEEP | bullboard/src/server.ts checks REDIS_URL and exits 1, no automated test |
| specs/features/devtools/bullboard-queue-dashboard.feature | "bullboard service is included in scenarios profile" | DUPLICATE | Covered by langwatch/src/server/__tests__/bullboard-compose.unit.test.ts (profile/mount/port assertions) |
| specs/features/devtools/bullboard-queue-dashboard.feature | "Bull Board UI loads via dev-scenarios" | KEEP | compose.dev.yml has bullboard in scenarios profile, no E2E test |
| specs/features/devtools/bullboard-queue-dashboard.feature | "Bull Board displays configured BullMQ queues" | KEEP | bullboard/src/redisQueues.ts discovers queue names dynamically, no E2E test |
| specs/features/evaluations-v3/thread-variables-in-trace-evaluator.feature | "Trace-level mapping UI includes both trace and thread available sources" | KEEP | getTraceAvailableSources() returns Current Trace + Current Thread groups, tested in thread-variables-in-trace-evaluator.unit.test.ts (no @scenario binding) |
| specs/features/evaluations-v3/thread-variables-in-trace-evaluator.feature | "Thread-level mapping UI still shows only thread sources" | KEEP | getThreadAvailableSources() omits Trace group, tested in thread-variables-in-trace-evaluator.unit.test.ts |
| specs/features/evaluations-v3/thread-variables-in-trace-evaluator.feature | "Thread source fields include thread_id, traces, and formatted_traces" | KEEP | tracesMapping.ts SERVER_ONLY_THREAD_SOURCES + tests assert all three fields |
| specs/features/evaluations-v3/thread-variables-in-trace-evaluator.feature | "Serialization marks thread sources with type \"thread\" including SERVER_ONLY_THREAD_SOURCES" | KEEP | serializeMappingsToMappingState() sets type:thread, tested in thread-variables-serialization.unit.test.ts |
| specs/features/evaluations-v3/thread-variables-in-trace-evaluator.feature | "Deserialization assigns sourceId \"thread\" for thread-typed mappings at trace level" | KEEP | deserializeMappingStateToUI() restores sourceId:thread, tested in thread-variables-serialization.unit.test.ts |
| specs/features/evaluations-v3/thread-variables-in-trace-evaluator.feature | "Trace-level evaluation resolves a thread source mapping" | KEEP | EvaluationExecutionService.executeForTrace() handles thread.traces, tested in thread-variables-in-trace-evaluator.integration.test.ts |
| specs/features/evaluations-v3/thread-variables-in-trace-evaluator.feature | "Trace-level evaluation resolves mixed trace and thread source mappings" | KEEP | buildDataForEvaluation handles mixed sources, tested in integration test |
| specs/features/evaluations-v3/thread-variables-in-trace-evaluator.feature | "Trace-level evaluation with thread source but trace has no thread_id" | KEEP | Empty value fallback implemented, tested in integration test |
| specs/features/evaluations-v3/thread-variables-in-trace-evaluator.feature | "hasThreadMappings detects thread-typed mappings in a mixed config" | KEEP | hasThreadMappings() in threadMappingResolver.ts, tested in unit test |
| specs/features/evaluations-v3/thread-variables-in-trace-evaluator.feature | "Background worker resolves mixed trace and thread mappings" | KEEP | evaluationsWorker.ts uses same hasThreadMappings/buildDataForEvaluation, tested via service integration test |
| specs/features/evaluations-v3/thread-variables-in-trace-evaluator.feature | "DatasetMappingPreview tab label reads \"Thread\" not \"Threads\"" | DELETE | DatasetMappingPreview has no Thread/Threads tab; uses isThreadMapping toggle, no tab label exists |
| specs/features/evaluations-v3/evaluator-run-rerun-enhancements.feature | "Pending evaluator chip shows \"Run\" when target output exists" | KEEP | EvaluatorChip.tsx shows Run when pending+hasTargetOutput, covered by EvaluatorChip.test.tsx |
| specs/features/evaluations-v3/evaluator-run-rerun-enhancements.feature | "Pending evaluator chip hides \"Run\" when no target output exists" | KEEP | EvaluatorChip.tsx disables Run via tooltip when !hasTargetOutput, covered by test |
| specs/features/evaluations-v3/evaluator-run-rerun-enhancements.feature | "Running a pending evaluator executes without re-running the target" | KEEP | useExecuteEvaluation evaluator-all-rows scope skips target execution, no specific binding |
| specs/features/evaluations-v3/evaluator-run-rerun-enhancements.feature | "Completed evaluator chip shows \"Rerun\" instead of \"Run\"" | KEEP | EvaluatorChip.tsx renders Rerun when status!=pending, covered by EvaluatorChip.test.tsx |
| specs/features/evaluations-v3/evaluator-run-rerun-enhancements.feature | "Running evaluator chip hides both \"Run\" and \"Rerun\"" | KEEP | EvaluatorChip.tsx hides menu items when status==running, covered by test |
| specs/features/evaluations-v3/evaluator-run-rerun-enhancements.feature | "Evaluator chip menu shows \"Run on all rows\" when target outputs exist" | KEEP | EvaluatorChip.tsx onRunOnAllRows menu item, covered by EvaluatorChip.test.tsx |
| specs/features/evaluations-v3/evaluator-run-rerun-enhancements.feature | "\"Run on all rows\" is hidden when no rows have target outputs" | UPDATE | Implementation shows item as disabled rather than hidden — spec/code differ in semantics |
| specs/features/evaluations-v3/evaluator-run-rerun-enhancements.feature | "\"Run on all rows\" is hidden while evaluator is running" | KEEP | EvaluatorChip.tsx omits onRunOnAllRows when status==running, covered by test |
| specs/features/evaluations-v3/evaluator-run-rerun-enhancements.feature | "\"Run on all rows\" executes the evaluator only on rows with existing target outputs" | KEEP | computeExecutionCells uses scope.precomputedTargetOutputs keys to filter rows, no specific binding |
| specs/features/evaluations-v3/evaluator-run-rerun-enhancements.feature | "\"Run on all rows\" reuses existing trace IDs" | KEEP | useExecuteEvaluation reuses trace IDs from precomputedTargetOutputs, no specific binding |
| specs/features/evaluations-v3/evaluator-run-rerun-enhancements.feature | "Running evaluator on all rows creates one execution per row with target output" | KEEP | computeExecutionCells in executionScope.ts emits one cell per precomputed row, no unit test for evaluator-all-rows scope |
