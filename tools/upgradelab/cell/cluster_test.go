package cell

import (
	"strings"
	"testing"
)

func TestOneNodeStoresCreatePlainDatabasesAndSetNoCluster(t *testing.T) {
	stores := Stores{Name: "upgradelab_x", RedisPort: "1"}
	if got := stores.createDatabase("upgradelab_x"); got != "CREATE DATABASE upgradelab_x" {
		t.Errorf("create: %q", got)
	}
	if got := stores.dropDatabase("upgradelab_x"); got != "DROP DATABASE IF EXISTS upgradelab_x" {
		t.Errorf("drop: %q", got)
	}
	env, err := BuildEnv(EnvInput{Profile: Profiles["cloud"], Stores: stores, APIPort: 7100})
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := env["CLICKHOUSE_CLUSTER"]; ok {
		t.Errorf("one node set CLICKHOUSE_CLUSTER=%q", env["CLICKHOUSE_CLUSTER"])
	}
}

func TestClusteredStoresCreateReplicatedDatabasesWhereTheAppBootstrapLooks(t *testing.T) {
	stores := Stores{Name: "upgradelab_x", RedisPort: "1", Cluster: "langwatch"}
	create := stores.createDatabase("upgradelab_x")
	for _, want := range []string{"ON CLUSTER langwatch", "ENGINE = Replicated('/clickhouse/databases/upgradelab_x', '{shard}', '{replica}')"} {
		if !strings.Contains(create, want) {
			t.Errorf("create %q lacks %q", create, want)
		}
	}
	if got := stores.dropDatabase("upgradelab_x"); got != "DROP DATABASE IF EXISTS upgradelab_x ON CLUSTER langwatch SYNC" {
		t.Errorf("drop: %q", got)
	}
	env, err := BuildEnv(EnvInput{Profile: Profiles["cloud"], Stores: stores, APIPort: 7100})
	if err != nil {
		t.Fatal(err)
	}
	if env["CLICKHOUSE_CLUSTER"] != "langwatch" {
		t.Errorf("CLICKHOUSE_CLUSTER %q", env["CLICKHOUSE_CLUSTER"])
	}
}
