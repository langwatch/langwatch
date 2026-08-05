package config

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestHydrate_String(t *testing.T) {
	type cfg struct {
		Host string `env:"HOST"`
	}
	t.Setenv("HOST", "localhost")

	var c cfg
	require.NoError(t, Hydrate(&c))

	assert.Equal(t, "localhost", c.Host)
}

func TestHydrate_Int(t *testing.T) {
	type cfg struct {
		Port int `env:"PORT"`
	}
	t.Setenv("PORT", "8080")

	var c cfg
	require.NoError(t, Hydrate(&c))

	assert.Equal(t, 8080, c.Port)
}

func TestHydrate_Bool(t *testing.T) {
	type cfg struct {
		Debug bool `env:"DEBUG"`
	}
	t.Setenv("DEBUG", "true")

	var c cfg
	require.NoError(t, Hydrate(&c))

	assert.True(t, c.Debug)
}

func TestHydrate_NestedStruct(t *testing.T) {
	type db struct {
		Host string `env:"HOST"`
		Port int    `env:"PORT"`
	}
	type cfg struct {
		DB db `env:"DB"`
	}
	t.Setenv("DB_HOST", "pg.local")
	t.Setenv("DB_PORT", "5432")

	var c cfg
	require.NoError(t, Hydrate(&c))

	assert.Equal(t, "pg.local", c.DB.Host)
	assert.Equal(t, 5432, c.DB.Port)
}

func TestHydrate_Error_NonPointer(t *testing.T) {
	type cfg struct {
		Host string `env:"HOST"`
	}

	assert.Error(t, Hydrate(cfg{}))
}

// @scenario "an env-tagged time.Duration field is refused"
func TestHydrate_Duration_FieldIsRefused(t *testing.T) {
	type cfg struct {
		SoftBump time.Duration `env:"SOFT_BUMP"`
	}
	t.Setenv("SOFT_BUMP", "5m")

	var c cfg
	err := Hydrate(&c)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "SOFT_BUMP")
	assert.Contains(t, err.Error(), "time.Duration")
	assert.Contains(t, err.Error(), "_SECONDS")
}

// @scenario "an env-tagged time.Duration field is refused even when its variable is unset"
func TestHydrate_Duration_FieldIsRefusedWhenEnvUnset(t *testing.T) {
	type cfg struct {
		HardGrace time.Duration `env:"HARD_GRACE_UNSET"`
	}

	var c cfg
	err := Hydrate(&c)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "HARD_GRACE_UNSET")
	assert.Zero(t, c.HardGrace)
}

// @scenario "a time.Duration field nested in a sub-struct is refused with its full prefixed name"
func TestHydrate_Duration_NestedFieldIsRefused(t *testing.T) {
	type inner struct {
		ConfigTTL time.Duration `env:"CONFIG_TTL"`
	}
	type cfg struct {
		AuthCache inner `env:"LW_GATEWAY_AUTH_CACHE"`
	}

	var c cfg
	err := Hydrate(&c)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "LW_GATEWAY_AUTH_CACHE_CONFIG_TTL")
}

// @scenario "a plain int64 field is unaffected by the time.Duration refusal"
func TestHydrate_Int64_StillParsesAsPlainInteger(t *testing.T) {
	type cfg struct {
		Count int64 `env:"COUNT"`
	}
	t.Setenv("COUNT", "300000000000")

	var c cfg
	require.NoError(t, Hydrate(&c))

	assert.Equal(t, int64(300000000000), c.Count)
}
