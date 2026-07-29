package domain

import (
	"fmt"

	"gopkg.in/yaml.v3"
)

// The bundle's config files, by their path inside the container. haven derives an
// override for each from the image's own copy and bind-mounts it back read-only.
//
// Derived rather than vendored on purpose: upstream's configs carry a lot we want
// to keep (Prometheus's whole promote list, Loki's schema and ring setup, Tempo's
// receiver wiring), and a vendored copy would silently rot against an image bump.
// Reading the file out of the image and editing the two or three keys we care
// about means an image bump brings its own new defaults along with our caps.
//
// The edits go through the yaml.Node tree rather than a decoded map, because a map
// round-trip mangles scalars YAML would otherwise leave alone — Loki's schema
// `from: 2020-10-24` decodes to a timestamp and re-emits as an RFC3339 string it
// then refuses to parse. Node preserves every untouched scalar exactly as shipped.
const (
	PrometheusConfigPath = "/otel-lgtm/prometheus.yaml"
	LokiConfigPath       = "/otel-lgtm/loki-config.yaml"
	TempoConfigPath      = "/otel-lgtm/tempo-config.yaml"
)

// PatchPrometheusConfig promotes langwatch.worktree to a metric label.
//
// Traces and logs carry resource attributes through to Tempo and Loki on their
// own. Prometheus does not: its OTLP receiver promotes only the attributes named
// in its config, and the bundle ships a fixed list that knows nothing about us.
// Without this, every worktree's langwatch-backend metrics collapse into one
// indistinguishable series and "filter Grafana to your worktree" quietly stops
// being true for a third of the telemetry.
//
// Prometheus's own retention is set by flag, not here — see PrometheusExtraArgs.
func PatchPrometheusConfig(config string) (string, error) {
	doc, err := parseYAML(config)
	if err != nil {
		return "", fmt.Errorf("prometheus config: %w", err)
	}
	root := docRoot(doc)
	promoted := mapValue(root, "otlp", "promote_resource_attributes")
	if promoted == nil || promoted.Kind != yaml.SequenceNode {
		return "", fmt.Errorf("prometheus config has no `otlp.promote_resource_attributes` list — cannot promote %s to a metric label", ObservabilityWorktreeAttr)
	}
	for _, item := range promoted.Content {
		if item.Value == ObservabilityWorktreeAttr {
			return config, nil
		}
	}
	promoted.Content = append(promoted.Content, scalar(ObservabilityWorktreeAttr))
	return renderYAML(doc)
}

// PatchLokiConfig gives Loki a retention window and an ingestion ceiling.
//
// The bundle ships Loki with neither: it keeps every log line forever, and will
// accept them as fast as they arrive. One `for` loop logging in anger can put
// gigabytes on the VM's disk before anyone notices. Retention needs the compactor
// switched on (it is the component that actually deletes), which in turn needs a
// working directory and a delete-request store.
func PatchLokiConfig(config string, l ObservabilityLimits) (string, error) {
	doc, err := parseYAML(config)
	if err != nil {
		return "", fmt.Errorf("loki config: %w", err)
	}
	root := docRoot(doc)
	setMapValue(root, scalar(l.Retention()), "limits_config", "retention_period")
	setMapValue(root, intScalar(l.IngestionRateMB), "limits_config", "ingestion_rate_mb")
	setMapValue(root, intScalar(l.IngestionRateMB*2), "limits_config", "ingestion_burst_size_mb")

	// Retention is inert unless the compactor runs and is told it may delete.
	setMapValue(root, scalar("/data/loki/compactor"), "compactor", "working_directory")
	setMapValue(root, boolScalar(true), "compactor", "retention_enabled")
	setMapValue(root, scalar("filesystem"), "compactor", "delete_request_store")
	// Aggressive by server standards, right for a stack whose whole horizon is the
	// last couple of hours: sweep every 10 minutes and delete almost immediately.
	setMapValue(root, scalar("10m"), "compactor", "compaction_interval")
	setMapValue(root, scalar("1m"), "compactor", "retention_delete_delay")
	return renderYAML(doc)
}

// PatchTempoConfig gives Tempo a block retention.
//
// Same story as Loki: the bundle configures none, so spans accumulate for as long
// as the container lives. block_retention is the only knob that matters — the
// compactor drops whole blocks older than it.
func PatchTempoConfig(config string, l ObservabilityLimits) (string, error) {
	doc, err := parseYAML(config)
	if err != nil {
		return "", fmt.Errorf("tempo config: %w", err)
	}
	setMapValue(docRoot(doc), scalar(l.Retention()), "compactor", "compaction", "block_retention")
	return renderYAML(doc)
}

func parseYAML(config string) (*yaml.Node, error) {
	var doc yaml.Node
	if err := yaml.Unmarshal([]byte(config), &doc); err != nil {
		return nil, err
	}
	if len(doc.Content) == 0 || doc.Content[0].Kind != yaml.MappingNode {
		return nil, fmt.Errorf("config is not a YAML mapping")
	}
	return &doc, nil
}

func renderYAML(doc *yaml.Node) (string, error) {
	out, err := yaml.Marshal(doc)
	if err != nil {
		return "", err
	}
	return string(out), nil
}

// docRoot is the top-level mapping node inside a decoded document.
func docRoot(doc *yaml.Node) *yaml.Node { return doc.Content[0] }

// mapValue walks a key path through mapping nodes, returning the value node or nil.
func mapValue(node *yaml.Node, path ...string) *yaml.Node {
	for _, key := range path {
		if node == nil || node.Kind != yaml.MappingNode {
			return nil
		}
		node = childValue(node, key)
	}
	return node
}

// childValue returns the value node for key in a mapping (its Content alternates
// key, value, key, value…), or nil.
func childValue(mapping *yaml.Node, key string) *yaml.Node {
	for i := 0; i+1 < len(mapping.Content); i += 2 {
		if mapping.Content[i].Value == key {
			return mapping.Content[i+1]
		}
	}
	return nil
}

// setMapValue assigns value at a nested key path, creating mapping nodes on the
// way down. It only ever touches the keys named, so everything else upstream
// shipped survives byte-for-byte.
func setMapValue(root *yaml.Node, value *yaml.Node, path ...string) {
	node := root
	for _, key := range path[:len(path)-1] {
		child := childValue(node, key)
		if child == nil || child.Kind != yaml.MappingNode {
			child = &yaml.Node{Kind: yaml.MappingNode}
			node.Content = append(node.Content, scalar(key), child)
		}
		node = child
	}
	last := path[len(path)-1]
	if existing := childValue(node, last); existing != nil {
		*existing = *value
		return
	}
	node.Content = append(node.Content, scalar(last), value)
}

func scalar(v string) *yaml.Node { return &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: v} }
func intScalar(v int) *yaml.Node {
	return &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!int", Value: fmt.Sprint(v)}
}
func boolScalar(v bool) *yaml.Node {
	return &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!bool", Value: fmt.Sprint(v)}
}
