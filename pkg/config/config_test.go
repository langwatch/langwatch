package config

import (
	"testing"

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
