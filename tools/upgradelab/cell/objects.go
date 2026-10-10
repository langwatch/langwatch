package cell

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"
)

// ObjectAccount is one S3 account in main's DATAPLANE_S3 JSON shape; the keys are storagesim test keys.
type ObjectAccount struct {
	Endpoint        string `json:"endpoint"`
	Bucket          string `json:"bucket"`
	AccessKeyID     string `json:"accessKeyId"`
	SecretAccessKey string `json:"secretAccessKey"`
}

// ObjectAccount is the account of one object target: "" shared, else a private label.
func (stores Stores) ObjectAccount(label string) ObjectAccount {
	name := "shared"
	if label != "" {
		name = "private-" + label
	}
	return ObjectAccount{Endpoint: "http://127.0.0.1:" + itoa(stores.S3[label]), Bucket: "upgradelab-" + name,
		AccessKeyID: "upgradelab-" + name, SecretAccessKey: "upgradelab-" + name + "-test-secret"}
}

// startObjectStores runs one storagesim per object target, each with its own data directory and key.
func (cell *run) startObjectStores(labels []string) error {
	binary, err := filepath.Abs(cell.options.ServiceBin)
	if err != nil {
		return err
	}
	cell.stores.S3 = map[string]int{}
	for _, label := range append([]string{""}, labels...) {
		port, err := FreePort()
		if err != nil {
			return err
		}
		cell.stores.S3[label] = port
		account := cell.stores.ObjectAccount(label)
		dir := filepath.Join(cell.options.RunDir, account.Bucket)
		if err := os.MkdirAll(dir, 0o750); err != nil {
			return err
		}
		proc, err := Start(ProcSpec{Name: account.Bucket, Dir: dir, Log: cell.logPath(account.Bucket), Args: []string{binary, "storagesim"},
			Env: Env(map[string]string{"PATH": os.Getenv("PATH"), "HOME": os.Getenv("HOME"), "STORAGESIM_ADDR": "127.0.0.1:" + itoa(port),
				"STORAGESIM_DATA_DIR": dir, "STORAGESIM_ACCESS_KEY_ID": account.AccessKeyID, "STORAGESIM_SECRET_ACCESS_KEY": account.SecretAccessKey,
				"STORAGESIM_BUCKETS": account.Bucket})})
		if err != nil {
			return err
		}
		cell.procs = append(cell.procs, proc)
	}
	return nil
}

// objectKeys lists every key in one target's storagesim, through its console API.
func (stores Stores) objectKeys(ctx context.Context, label string) ([]string, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://127.0.0.1:"+itoa(stores.S3[label])+"/_sim/api/objects", http.NoBody)
	if err != nil {
		return nil, err
	}
	response, err := httpClient.Do(request)
	if err != nil {
		return nil, err
	}
	defer func() { _ = response.Body.Close() }()
	var body struct {
		Objects []struct{ Bucket, Key string }
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		return nil, err
	}
	keys := make([]string, 0, len(body.Objects))
	for _, object := range body.Objects {
		keys = append(keys, object.Bucket+"/"+object.Key)
	}
	return keys, nil
}

// privatePrefix names the traffic a private organization's project sends (hybrid).
const privatePrefix = "private-"

// privateClient speaks as the first live project of the first private organization, with its project key.
func (cell *run) privateClient() (Client, string, bool) {
	for label, organization := range cell.private {
		for index := range cell.tenancy.Projects {
			project := cell.tenancy.Projects[index]
			if !project.Archived && slices.Contains(cell.tenancy.ProjectsOf(organization), project.ID) {
				return Client{URL: cell.url(), APIKey: project.APIKey, Project: project.ID, Seed: cell.options.Seed + 1_000_000}, label, true
			}
		}
	}
	return Client{}, "", false
}

// PrivateMix is a private project's traffic: traces, datasets with rows (objects), and reads.
func PrivateMix(rate time.Duration) []Kind {
	return []Kind{
		{Name: privatePrefix + "otlp-trace", Every: rate, Write: true, Do: otlpTrace},
		{Name: privatePrefix + "dataset", Every: 4 * rate, Write: true, Do: datasetWithRows},
		{Name: privatePrefix + "rest-read", Every: 2 * rate, Do: restRead},
	}
}

// datasetWithRows creates a dataset, then answers the request that writes its rows (s3_jsonl objects).
func datasetWithRows(ctx context.Context, client Client, n int) (*http.Request, string, error) {
	name := "upgradelab-" + SeededID(client.Seed, "dataset", n)[:12]
	create, err := client.post(ctx, "/api/dataset", map[string]any{"name": name, "columnTypes": []any{map[string]any{"name": "input", "type": "string"}}})
	if err != nil {
		return nil, name, err
	}
	response, err := httpClient.Do(create)
	if err != nil {
		return nil, name, err
	}
	_ = response.Body.Close()
	if response.StatusCode/100 != 2 && response.StatusCode != http.StatusConflict {
		create, err = client.post(ctx, "/api/dataset", map[string]any{"name": name, "columnTypes": []any{map[string]any{"name": "input", "type": "string"}}})
		return create, name, err // the traffic sends the create again, so its answer (e.g. upgrade_in_progress) is the call's
	}
	request, err := client.post(ctx, "/api/dataset/"+name+"/entries", map[string]any{"entries": []any{map[string]any{"input": "row " + name}}})
	return request, name, err
}

// privateVisible: a private trace is on the private target; a private dataset reads back with its own key.
func (cell *run) privateVisible(ctx context.Context, call Call, spans map[string]bool) bool {
	if call.Kind == privatePrefix+"otlp-trace" {
		return spans[call.ID]
	}
	return cell.foundAs(ctx, "/api/dataset/"+call.ID, cell.privateTraffic.Client.APIKey) == http.StatusOK
}

func (cell *run) foundAs(ctx context.Context, path, key string) int {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, cell.url()+path, http.NoBody)
	if err != nil {
		return 0
	}
	request.Header.Set("X-Auth-Token", key)
	response, err := httpClient.Do(request)
	if err != nil {
		return 0
	}
	_ = response.Body.Close()
	return response.StatusCode
}

// isolationVerdicts: H3 the private project reads its own data, H4 objects stay in their tenant's S3,
// H5 the shared project cannot read the private one's trace or dataset.
func (cell *run) isolationVerdicts(ctx context.Context) []Verdict {
	if cell.privateTraffic == nil {
		return []Verdict{{ID: "H3", Name: invariantNames["H3"], Result: "inconclusive", Detail: "no private project in the tenancy"}}
	}
	trace, dataset := cell.firstPrivateWrites()
	own := map[string]int{"trace": cell.foundAs(ctx, "/api/traces/"+trace, cell.privateTraffic.Client.APIKey), "dataset": cell.foundAs(ctx, "/api/dataset/"+dataset, cell.privateTraffic.Client.APIKey)}
	other := map[string]int{"trace": cell.foundAs(ctx, "/api/traces/"+trace, cell.client.APIKey), "dataset": cell.foundAs(ctx, "/api/dataset/"+dataset, cell.client.APIKey)}
	return []Verdict{
		verdict("H3", trace != "" && dataset != "" && own["trace"] == http.StatusOK && own["dataset"] == http.StatusOK,
			fmt.Sprintf("private key reading trace %q and dataset %q answered %v", trace, dataset, own)),
		cell.objectsVerdict(ctx),
		verdict("H5", trace != "" && dataset != "" && other["trace"]/100 == 4 && other["dataset"]/100 == 4,
			fmt.Sprintf("shared project's key reading the private trace and dataset answered %v (want 4xx)", other)),
	}
}

// firstPrivateWrites is one stored private trace id and one created private dataset name.
func (cell *run) firstPrivateWrites() (trace, dataset string) {
	for _, call := range cell.privateTraffic.Calls() {
		switch {
		case call.ok() && trace == "" && call.Kind == privatePrefix+"otlp-trace":
			trace = call.ID
		case call.ok() && dataset == "" && call.Kind == privatePrefix+"dataset":
			dataset = call.ID
		}
	}
	return trace, dataset
}

// objectsVerdict: the private S3 holds objects, none naming a shared project; the shared S3 names no private project.
func (cell *run) objectsVerdict(ctx context.Context) Verdict {
	privateProjects := map[string]bool{}
	for _, organization := range cell.private {
		for _, project := range cell.tenancy.ProjectsOf(organization) {
			privateProjects[project] = true
		}
	}
	counts, misplaced := map[string]int{}, []string{}
	var errs error
	for label := range cell.stores.S3 {
		keys, err := cell.stores.objectKeys(ctx, label)
		errs = errors.Join(errs, err)
		counts[cell.stores.ObjectAccount(label).Bucket] = len(keys)
		for _, key := range keys {
			private := false
			for project := range privateProjects {
				private = private || strings.Contains(key, project)
			}
			shared := strings.Contains(key, cell.client.Project)
			if (label == "" && private) || (label != "" && shared) {
				misplaced = append(misplaced, key)
			}
		}
	}
	privateCount := 0
	for label := range cell.private {
		privateCount += counts[cell.stores.ObjectAccount(label).Bucket]
	}
	return verdict("H4", errs == nil && privateCount > 0 && len(misplaced) == 0,
		fmt.Sprintf("objects per bucket %v; misplaced %v %s", counts, misplaced, errText(errs)))
}
