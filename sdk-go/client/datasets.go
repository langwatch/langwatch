package client

import (
	"context"
	"encoding/json"

	"github.com/langwatch/langwatch/sdk-go/client/internal/openapi"
)

// DatasetsService is the client for LangWatch datasets and their records.
//
// Access it via [Client.Datasets]. Dataset list endpoints use offset
// pagination: pass [ListDatasetsParams] with Page and Limit and inspect the
// returned [Pagination].
type DatasetsService struct {
	client *Client
}

// Pagination is the page/limit/total envelope returned by offset-paginated list
// endpoints.
type Pagination struct {
	Page  int `json:"page"`
	Limit int `json:"limit"`
	Total int `json:"total"`
}

// ListDatasetsParams controls offset pagination for [DatasetsService.List]. Zero
// values mean "use the server default".
type ListDatasetsParams struct {
	Page  int
	Limit int
}

// Dataset is a dataset record as returned by the API. The API returns datasets
// as a free-form object whose exact shape varies by dataset configuration, so
// the columns are exposed as a raw decoded map alongside the stable identity
// fields.
type Dataset struct {
	ID     string         `json:"id"`
	Slug   string         `json:"slug"`
	Name   string         `json:"name"`
	Fields map[string]any `json:"-"`
}

// UnmarshalJSON decodes both the stable identity fields and the full object into
// Fields, so callers can read configuration the SDK does not model explicitly.
func (d *Dataset) UnmarshalJSON(data []byte) error {
	type alias Dataset
	var a alias
	if err := json.Unmarshal(data, &a); err != nil {
		return err
	}
	*d = Dataset(a)
	return json.Unmarshal(data, &d.Fields)
}

// listDatasetsEnvelope is the offset-paginated response for List. The API
// returns { data, pagination }.
type listDatasetsEnvelope struct {
	Data       []Dataset  `json:"data"`
	Pagination Pagination `json:"pagination"`
}

// List returns a page of datasets in the project along with pagination metadata.
//
//	page, pg, err := lw.Datasets.List(ctx, client.ListDatasetsParams{Page: 1, Limit: 50})
//	for _, d := range page { fmt.Println(d.Slug) }
//	hasMore := pg.Page*pg.Limit < pg.Total
func (s *DatasetsService) List(ctx context.Context, params ListDatasetsParams) ([]Dataset, Pagination, error) {
	p := &openapi.GetApiDatasetParams{}
	if params.Page > 0 {
		p.Page = &params.Page
	}
	if params.Limit > 0 {
		p.Limit = &params.Limit
	}
	resp, err := s.client.gen.GetApiDataset(ctx, p)
	var env listDatasetsEnvelope
	if derr := decodeInto("Datasets.List", resp, err, &env); derr != nil {
		return nil, Pagination{}, derr
	}
	return env.Data, env.Pagination, nil
}

// Get fetches a single dataset by slug or ID.
//
//	d, err := lw.Datasets.Get(ctx, "golden-examples")
func (s *DatasetsService) Get(ctx context.Context, slugOrID string) (*Dataset, error) {
	resp, err := s.client.gen.GetApiDatasetBySlugOrId(ctx, slugOrID)
	var out Dataset
	if derr := decodeInto("Datasets.Get", resp, err, &out); derr != nil {
		return nil, derr
	}
	return &out, nil
}

// CreateRecords appends records to a dataset. entries is a list of records, each
// a map from column name to value, matching the dataset's schema. The decoded
// API response is returned as a free-form map.
//
//	res, err := lw.Datasets.CreateRecords(ctx, "golden-examples", []map[string]any{
//		{"input": "hello", "expected_output": "hi"},
//	})
func (s *DatasetsService) CreateRecords(ctx context.Context, slugOrID string, entries []map[string]any) (map[string]any, error) {
	body, err := jsonReader(map[string]any{"entries": entries})
	if err != nil {
		return nil, err
	}
	resp, err := s.client.gen.PostApiDatasetBySlugOrIdRecordsWithBody(ctx, slugOrID, contentTypeJSON, body)
	var out map[string]any
	if derr := decodeInto("Datasets.CreateRecords", resp, err, &out); derr != nil {
		return nil, derr
	}
	return out, nil
}

// ListRecords returns a page of a dataset's records along with pagination
// metadata. Records are returned as free-form maps because their columns depend
// on the dataset's schema.
//
//	records, pg, err := lw.Datasets.ListRecords(ctx, "golden-examples", client.ListDatasetsParams{Page: 1, Limit: 100})
func (s *DatasetsService) ListRecords(ctx context.Context, slugOrID string, params ListDatasetsParams) ([]map[string]any, Pagination, error) {
	p := &openapi.GetApiDatasetBySlugOrIdRecordsParams{}
	if params.Page > 0 {
		p.Page = &params.Page
	}
	if params.Limit > 0 {
		p.Limit = &params.Limit
	}
	resp, err := s.client.gen.GetApiDatasetBySlugOrIdRecords(ctx, slugOrID, p)
	var env struct {
		Data       []map[string]any `json:"data"`
		Pagination Pagination       `json:"pagination"`
	}
	if derr := decodeInto("Datasets.ListRecords", resp, err, &env); derr != nil {
		return nil, Pagination{}, derr
	}
	return env.Data, env.Pagination, nil
}

// Delete removes a dataset by slug or ID. The decoded API response is returned
// as a free-form map.
//
//	_, err := lw.Datasets.Delete(ctx, "golden-examples")
func (s *DatasetsService) Delete(ctx context.Context, slugOrID string) (map[string]any, error) {
	resp, err := s.client.gen.DeleteApiDatasetBySlugOrId(ctx, slugOrID)
	var out map[string]any
	if derr := decodeInto("Datasets.Delete", resp, err, &out); derr != nil {
		return nil, derr
	}
	return out, nil
}
