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

// @scenario "a documented duration string like 5m parses correctly"
func TestHydrate_Duration_HumanReadableString(t *testing.T) {
	type cfg struct {
		SoftBump time.Duration `env:"SOFT_BUMP"`
	}
	t.Setenv("SOFT_BUMP", "5m")

	var c cfg
	require.NoError(t, Hydrate(&c))

	assert.Equal(t, 5*time.Minute, c.SoftBump)
}

// @scenario "a negative duration string parses correctly, matching the negative-disables convention"
func TestHydrate_Duration_Negative(t *testing.T) {
	type cfg struct {
		HardGrace time.Duration `env:"HARD_GRACE"`
	}
	t.Setenv("HARD_GRACE", "-1s")

	var c cfg
	require.NoError(t, Hydrate(&c))

	assert.Equal(t, -1*time.Second, c.HardGrace)
}

// @scenario "a raw nanosecond integer no longer parses as a duration"
func TestHydrate_Duration_RawNanosecondsNowRejected(t *testing.T) {
	// This is the exact value that USED to be the only thing that worked —
	// asserting it now fails is the regression test for the bug: a
	// documented value like "5m" must parse, not an opaque nanosecond count.
	type cfg struct {
		ConfigTTL time.Duration `env:"CONFIG_TTL"`
	}
	t.Setenv("CONFIG_TTL", "300000000000")

	var c cfg
	err := Hydrate(&c)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "CONFIG_TTL")
}

// @scenario "a plain int64 field is unaffected by the duration special-case"
func TestHydrate_Int64_StillParsesAsPlainInteger(t *testing.T) {
	type cfg struct {
		Count int64 `env:"COUNT"`
	}
	t.Setenv("COUNT", "300000000000")

	var c cfg
	require.NoError(t, Hydrate(&c))

	assert.Equal(t, int64(300000000000), c.Count)
}
