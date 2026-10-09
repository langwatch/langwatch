package domain

import (
	"path/filepath"
	"strings"
	"testing"

	"gopkg.in/yaml.v3"
)

func nativePlan() NativeObservabilityPlan {
	return NativeObservabilityPlan{
		Dir:       "/home/haven/observability",
		Endpoints: DefaultObservabilityEndpoints(),
		Ports:     DefaultNativeObservabilityPorts(),
		Limits:    DefaultObservabilityLimits(16<<30, 8),
	}
}

func nativeComponent(t *testing.T, name string) NativeComponent {
	t.Helper()
	for _, c := range NativeObservabilityComponents(nativePlan(), "/brew/share/grafana") {
		if c.Name == name {
			return c
		}
	}
	t.Fatalf("no %s component", name)
	return NativeComponent{}
}

func nativeFile(t *testing.T, component, file string) string {
	t.Helper()
	body, ok := nativeComponent(t, component).Files[file]
	if !ok {
		t.Fatalf("%s renders no %s", component, file)
	}
	return body
}

// @scenario "A Mac runs the native stack even with a container runtime installed"
func TestMacDefaultsToTheNativeTier(t *testing.T) {
	if tier, ok := ObservabilityTierFor("darwin", ""); tier != ObservabilityTierNative || !ok {
		t.Errorf("darwin default = %s, %v; want native, true", tier, ok)
	}
}

// @scenario "A machine with no container runtime uses the native tier"
func TestNativeTierDoesNotDependOnAContainerRuntime(t *testing.T) {
	if tier, _ := ObservabilityTierFor("darwin", ""); tier != ObservabilityTierNative {
		t.Errorf("darwin default = %s, want native", tier)
	}
}

// @scenario "A machine with a container runtime keeps the bundled stack"
func TestLinuxDefaultsToTheContainerTier(t *testing.T) {
	if tier, ok := ObservabilityTierFor("linux", ""); tier != ObservabilityTierContainer || !ok {
		t.Errorf("linux default = %s, %v; want container, true", tier, ok)
	}
}

// @scenario "The tier can be pinned either way"
func TestTheTierCanBePinned(t *testing.T) {
	cases := []struct {
		goos, pinned string
		want         ObservabilityTier
		ok           bool
	}{
		{"darwin", "container", ObservabilityTierContainer, true},
		{"darwin", " Container ", ObservabilityTierContainer, true},
		{"linux", "native", ObservabilityTierNative, true},
		{"darwin", "vm", ObservabilityTierNative, false},
		{"linux", "vm", ObservabilityTierContainer, false},
	}
	for _, c := range cases {
		if got, ok := ObservabilityTierFor(c.goos, c.pinned); got != c.want || ok != c.ok {
			t.Errorf("ObservabilityTierFor(%q, %q) = %s, %v; want %s, %v", c.goos, c.pinned, got, ok, c.want, c.ok)
		}
	}
}

// @scenario "One OTLP endpoint, on the same port"
func TestCollectorAndGrafanaKeepTheContainerPorts(t *testing.T) {
	collector := nativeFile(t, "alloy", "collector.alloy")
	for _, want := range []string{`endpoint = "127.0.0.1:4317"`, `endpoint = "127.0.0.1:4318"`} {
		if !strings.Contains(collector, want) {
			t.Errorf("collector config lacks %s", want)
		}
	}
	ini := nativeFile(t, "grafana", "grafana.ini")
	for _, want := range []string{"http_addr = 127.0.0.1", "http_port = 3000"} {
		if !strings.Contains(ini, want) {
			t.Errorf("grafana.ini lacks %q", want)
		}
	}
	if !nativeComponent(t, "alloy").Required || !nativeComponent(t, "grafana").Required {
		t.Error("the collector and Grafana carry the endpoints, so both must be required")
	}
}

// @scenario "Grafana can query every store under the same datasource ids"
func TestGrafanaDatasourcesKeepTheBundleUids(t *testing.T) {
	body := nativeFile(t, "grafana", filepath.Join("grafana-provisioning", "datasources", "datasources.yaml"))
	var doc struct {
		Datasources []struct {
			UID string `yaml:"uid"`
			URL string `yaml:"url"`
		} `yaml:"datasources"`
	}
	if err := yaml.Unmarshal([]byte(body), &doc); err != nil {
		t.Fatalf("datasources.yaml: %v", err)
	}
	got := map[string]string{}
	for _, d := range doc.Datasources {
		got[d.UID] = d.URL
	}
	want := map[string]string{
		"prometheus": "http://127.0.0.1:9090",
		"loki":       "http://127.0.0.1:3100",
		"tempo":      "http://127.0.0.1:3200",
		"pyroscope":  "http://127.0.0.1:4040",
	}
	if len(got) != len(want) {
		t.Errorf("datasources = %v, want exactly %v", got, want)
	}
	for uid, url := range want {
		if got[uid] != url {
			t.Errorf("datasource %s url = %q, want %q", uid, got[uid], url)
		}
	}
}

// @scenario "Profiles land on the container tier's port"
func TestNativePyroscopeServesTheContainerPort(t *testing.T) {
	c := nativeComponent(t, "pyroscope")
	if c.ReadyURL != "http://127.0.0.1:4040/ready" {
		t.Errorf("pyroscope ready url = %q, want the container's port 4040", c.ReadyURL)
	}
	var doc struct {
		Server struct {
			HTTPAddr string `yaml:"http_listen_address"`
			HTTPPort int    `yaml:"http_listen_port"`
			GRPCPort int    `yaml:"grpc_listen_port"`
		} `yaml:"server"`
		Memberlist struct {
			BindPort int `yaml:"bind_port"`
		} `yaml:"memberlist"`
		Architecture string `yaml:"architecture_storage"`
		Storage      struct {
			Filesystem struct {
				Dir string `yaml:"dir"`
			} `yaml:"filesystem"`
		} `yaml:"storage"`
	}
	if err := yaml.Unmarshal([]byte(nativeFile(t, "pyroscope", "pyroscope.yaml")), &doc); err != nil {
		t.Fatalf("pyroscope.yaml: %v", err)
	}
	ports := DefaultNativeObservabilityPorts()
	if doc.Server.HTTPAddr != "127.0.0.1" || doc.Server.HTTPPort != 4040 {
		t.Errorf("pyroscope serves %s:%d, want 127.0.0.1:4040", doc.Server.HTTPAddr, doc.Server.HTTPPort)
	}
	if doc.Server.GRPCPort == ports.TempoGRPC || doc.Memberlist.BindPort == ports.TempoGossip {
		t.Errorf("pyroscope grpc %d / gossip %d collide with tempo", doc.Server.GRPCPort, doc.Memberlist.BindPort)
	}
	if doc.Architecture != "v2" || !strings.HasPrefix(doc.Storage.Filesystem.Dir, nativePlan().DataDir()) {
		t.Errorf("pyroscope config = %+v, want v2 storage under the data directory", doc)
	}
}

// @scenario "Profiles land on the container tier's port"
func TestNativeTierWithoutAProfilerPortPlansNoPyroscope(t *testing.T) {
	p := nativePlan()
	p.Endpoints.PyroscopePort = 0
	for _, c := range NativeObservabilityComponents(p, "") {
		if c.Name == "pyroscope" {
			t.Error("pyroscope planned with no port")
		}
	}
	if strings.Contains(RenderNativeGrafanaDatasources(p), "pyroscope") {
		t.Error("grafana provisions a pyroscope datasource with nothing behind it")
	}
}

// @scenario "Metrics carry the worktree label"
func TestNativePrometheusPromotesTheWorktree(t *testing.T) {
	if !strings.Contains(nativeFile(t, "prometheus", "prometheus.yaml"), "- "+ObservabilityWorktreeAttr) {
		t.Errorf("prometheus.yaml does not promote %s", ObservabilityWorktreeAttr)
	}
	if !hasArg(nativeComponent(t, "prometheus").Args, "--web.enable-otlp-receiver") {
		t.Error("prometheus is started without its OTLP receiver")
	}
}

// @scenario "A missing binary prints its install line"
func TestEveryComponentCarriesAnInstallLine(t *testing.T) {
	for _, c := range NativeObservabilityComponents(nativePlan(), "") {
		if c.Install == "" {
			t.Errorf("%s has no install line", c.Name)
		}
	}
	if nativeComponent(t, "tempo").Required || nativeComponent(t, "loki").Required {
		t.Error("a missing store must not stop the rest of the stack from starting")
	}
}

// @scenario "Retention is capped"
func TestNativeStoresAreCappedUnderHavensHome(t *testing.T) {
	p := nativePlan()
	loki := nativeFile(t, "loki", "loki.yaml")
	tempo := nativeFile(t, "tempo", "tempo.yaml")
	for _, body := range []string{loki, tempo} {
		var doc map[string]any
		if err := yaml.Unmarshal([]byte(body), &doc); err != nil {
			t.Fatalf("config does not parse: %v", err)
		}
		if !strings.Contains(body, p.DataDir()) {
			t.Errorf("config keeps data outside %s", p.DataDir())
		}
	}
	if !strings.Contains(loki, "retention_period: 2h") || !strings.Contains(loki, "retention_enabled: true") {
		t.Error("loki has no retention")
	}
	if !strings.Contains(tempo, "block_retention: 2h") {
		t.Error("tempo has no block retention")
	}
	args := nativeComponent(t, "prometheus").Args
	if !hasArg(args, "--storage.tsdb.retention.time=2h") || !hasArg(args, "--storage.tsdb.path="+filepath.Join(p.DataDir(), "prometheus")) {
		t.Errorf("prometheus args = %v, want retention and data under haven's home", args)
	}
}

func TestGrafanaHomePathFollowsTheCellarLayout(t *testing.T) {
	got := GrafanaHomePath("/opt/homebrew/Cellar/grafana/13.2.3/bin/grafana")
	if want := "/opt/homebrew/Cellar/grafana/13.2.3/share/grafana"; got != want {
		t.Errorf("GrafanaHomePath = %q, want %q", got, want)
	}
}

func TestNativeMemoryIsSplitAcrossComponents(t *testing.T) {
	l := ObservabilityLimits{MemoryMB: 2500}
	if got := NativeMemoryLimitMB(l, 5); got != 500 {
		t.Errorf("NativeMemoryLimitMB = %d, want 500", got)
	}
	if got := NativeMemoryLimitMB(l, 0); got != 2500 {
		t.Errorf("NativeMemoryLimitMB with no components = %d, want the whole budget", got)
	}
}

func hasArg(list []string, want string) bool {
	for _, v := range list {
		if v == want {
			return true
		}
	}
	return false
}

// @scenario "Haven fetches a pinned, checksummed Alloy instead of building it"
func TestAlloyIsPinnedPerMacArchitecture(t *testing.T) {
	for _, arch := range []string{"arm64", "amd64"} {
		a, ok := AlloyNativeArtifactFor("darwin", arch)
		if !ok {
			t.Fatalf("no alloy pinned for darwin/%s", arch)
		}
		wantURL := "https://github.com/grafana/alloy/releases/download/v" + AlloyNativeVersion + "/alloy-darwin-" + arch + ".zip"
		if a.URL != wantURL || len(a.SHA256) != 64 || a.Member != "alloy-darwin-"+arch {
			t.Errorf("darwin/%s artifact = %+v, want %s with a sha256 and member alloy-darwin-%s", arch, a, wantURL, arch)
		}
	}
	arm, _ := AlloyNativeArtifactFor("darwin", "arm64")
	amd, _ := AlloyNativeArtifactFor("darwin", "amd64")
	if arm.SHA256 == amd.SHA256 {
		t.Error("both architectures carry the same digest")
	}
	if _, ok := AlloyNativeArtifactFor("linux", "amd64"); ok {
		t.Error("linux has no darwin zip to pin")
	}
	if got := nativePlan().AlloyBinary(); strings.HasPrefix(got, nativePlan().DataDir()) {
		t.Errorf("alloy binary %s sits under DataDir, which `down` discards", got)
	}
}

// @scenario "Haven fetches a pinned, checksummed Tempo"
func TestTempoIsPinnedPerMacArchitecture(t *testing.T) {
	for _, arch := range []string{"arm64", "amd64"} {
		a, ok := TempoNativeArtifactFor("darwin", arch)
		if !ok {
			t.Fatalf("no tempo pinned for darwin/%s", arch)
		}
		wantURL := "https://github.com/grafana/tempo/releases/download/v" + TempoNativeVersion +
			"/tempo_" + TempoNativeVersion + "_darwin_" + arch + ".tar.gz"
		if a.URL != wantURL || len(a.SHA256) != 64 || a.Member != "tempo" {
			t.Errorf("darwin/%s artifact = %+v, want %s with a sha256 and member tempo", arch, a, wantURL)
		}
	}
	arm, _ := TempoNativeArtifactFor("darwin", "arm64")
	amd, _ := TempoNativeArtifactFor("darwin", "amd64")
	if arm.SHA256 == amd.SHA256 {
		t.Error("both architectures carry the same digest")
	}
	if _, ok := TempoNativeArtifactFor("linux", "amd64"); ok {
		t.Error("linux has no darwin tarball to pin")
	}
	if got := nativePlan().TempoBinary(); strings.HasPrefix(got, nativePlan().DataDir()) {
		t.Errorf("tempo binary %s sits under DataDir, which `down` discards", got)
	}
}

// @scenario "Haven fetches a pinned, checksummed Pyroscope"
func TestPyroscopeIsPinnedPerMacArchitecture(t *testing.T) {
	for _, arch := range []string{"arm64", "amd64"} {
		a, ok := PyroscopeNativeArtifactFor("darwin", arch)
		if !ok {
			t.Fatalf("no pyroscope pinned for darwin/%s", arch)
		}
		wantURL := "https://github.com/grafana/pyroscope/releases/download/v" + PyroscopeNativeVersion +
			"/pyroscope_" + PyroscopeNativeVersion + "_darwin_" + arch + ".tar.gz"
		if a.URL != wantURL || len(a.SHA256) != 64 || a.Member != "pyroscope" {
			t.Errorf("darwin/%s artifact = %+v, want %s with a sha256 and member pyroscope", arch, a, wantURL)
		}
	}
	arm, _ := PyroscopeNativeArtifactFor("darwin", "arm64")
	amd, _ := PyroscopeNativeArtifactFor("darwin", "amd64")
	if arm.SHA256 == amd.SHA256 {
		t.Error("both architectures carry the same digest")
	}
	if _, ok := PyroscopeNativeArtifactFor("linux", "amd64"); ok {
		t.Error("linux has no darwin tarball to pin")
	}
	if got := nativePlan().PyroscopeBinary(); strings.HasPrefix(got, nativePlan().DataDir()) {
		t.Errorf("pyroscope binary %s sits under DataDir, which `down` discards", got)
	}
}

// @scenario "Haven fetches a pinned, checksummed Tempo"
func TestTempoConfigUsesTheThreeXKeys(t *testing.T) {
	body := nativeFile(t, "tempo", "tempo.yaml")
	var doc struct {
		Compactor     any `yaml:"compactor"`
		BackendWorker struct {
			Compaction struct {
				BlockRetention string `yaml:"block_retention"`
			} `yaml:"compaction"`
		} `yaml:"backend_worker"`
		Distributor struct {
			Receivers map[string]any `yaml:"receivers"`
		} `yaml:"distributor"`
	}
	if err := yaml.Unmarshal([]byte(body), &doc); err != nil {
		t.Fatalf("tempo.yaml does not parse: %v", err)
	}
	if doc.Compactor != nil {
		t.Error("compactor is a 2.x block; 3.x reads backend_worker.compaction")
	}
	if doc.BackendWorker.Compaction.BlockRetention != "2h" {
		t.Errorf("block_retention = %q, want 2h", doc.BackendWorker.Compaction.BlockRetention)
	}
	if _, ok := doc.Distributor.Receivers["otlp"]; !ok {
		t.Error("distributor has no otlp receiver")
	}
	if strings.Contains(body, "/var/tempo") || strings.Count(body, nativePlan().DataDir()) < 5 {
		t.Error("a tempo path is left on its /var/tempo default")
	}
}

// @scenario "Every signal reaches its store"
func TestEverySignalReachesItsStore(t *testing.T) {
	collector := nativeFile(t, "alloy", "collector.alloy")
	for _, want := range []string{
		"metrics = [otelcol.exporter.otlphttp.prometheus.input]",
		"logs    = [otelcol.exporter.otlphttp.loki.input]",
		"traces  = [otelcol.exporter.otlphttp.tempo.input]",
		`endpoint = "http://127.0.0.1:9090/api/v1/otlp"`,
		`endpoint = "http://127.0.0.1:3100/otlp"`,
		`endpoint = "http://127.0.0.1:4418"`,
	} {
		if !strings.Contains(collector, want) {
			t.Errorf("collector config lacks %s", want)
		}
	}
	prometheus := nativeComponent(t, "prometheus").Args
	for _, want := range []string{"--web.enable-otlp-receiver", "--web.listen-address=127.0.0.1:9090"} {
		if !hasArg(prometheus, want) {
			t.Errorf("prometheus is started without %s", want)
		}
	}
	stores := map[string][]string{
		"loki.yaml":  {"http_listen_port: 3100", "allow_structured_metadata: true"},
		"tempo.yaml": {"endpoint: 127.0.0.1:4418"},
	}
	for file, wants := range stores {
		body := nativeFile(t, strings.TrimSuffix(file, ".yaml"), file)
		for _, want := range wants {
			if !strings.Contains(body, want) {
				t.Errorf("%s lacks %q", file, want)
			}
		}
	}
}

// @scenario "A collector whose receiver did not start is down"
func TestCollectorReadinessCountsItsReceiver(t *testing.T) {
	if got := nativeComponent(t, "alloy").ReadyURL; got != "http://127.0.0.1:12345/-/healthy" {
		t.Errorf("alloy ReadyURL = %q, want /-/healthy: /-/ready is 200 with a dead receiver", got)
	}
}
