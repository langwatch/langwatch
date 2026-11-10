package ecrtag_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/tools/ecrtag"
)

const (
	sumA = "1111111111111111111111111111111111111111111111111111111111111111"
	sumB = "2222222222222222222222222222222222222222222222222222222222222222"
	fpA  = "0123456789abcdef0123456789abcdef"
	fpB  = "fedcba9876543210fedcba9876543210"
)

func renderOut(users, collection string) string {
	return collection + "  ./config.d/lwql-named-collection.yaml\n" + users + "  ./users.d/lwql-access.yaml\n"
}

// renders answers each docker run in turn.
type renders struct {
	outs  []string
	err   error
	calls []ecrtag.Command
}

func (r *renders) run(_ context.Context, c ecrtag.Command) (string, error) {
	r.calls = append(r.calls, c)
	if r.err != nil {
		return "", r.err
	}
	out := r.outs[0]
	if len(r.outs) > 1 {
		r.outs = r.outs[1:]
	}

	return out, nil
}

// @scenario "An app image records the fingerprint of the access model it renders"
func TestLwqlAccessFingerprint(t *testing.T) {
	ctx := context.Background()

	t.Run("renders offline in the image from two placeholder sets", func(t *testing.T) {
		r := &renders{outs: []string{renderOut(sumA, sumB)}}

		fingerprint, err := ecrtag.LwqlAccessFingerprint(ctx, r.run, "registry/langwatch-app:git-1-arm64")

		require.NoError(t, err)
		assert.Regexp(t, `^[0-9a-f]{32}$`, fingerprint)
		require.Len(t, r.calls, 2)
		for _, c := range r.calls {
			argv := strings.Join(c.Args, " ")
			assert.Equal(t, "docker", c.Name)
			assert.Contains(t, argv, "--network none")
			assert.Contains(t, argv, "registry/langwatch-app:git-1-arm64 -c")
			assert.Contains(t, argv, "pnpm --silent task lwql-render-access-config")
		}
		assert.NotEqual(t, r.calls[0].Args, r.calls[1].Args, "the two placeholder sets are the same")
	})

	t.Run("is the same for the same files and differs when a file does", func(t *testing.T) {
		same, err := ecrtag.LwqlAccessFingerprint(ctx, (&renders{outs: []string{renderOut(sumA, sumB)}}).run, "a")
		require.NoError(t, err)
		again, err := ecrtag.LwqlAccessFingerprint(ctx, (&renders{outs: []string{renderOut(sumA, sumB)}}).run, "b")
		require.NoError(t, err)
		changed, err := ecrtag.LwqlAccessFingerprint(ctx, (&renders{outs: []string{renderOut(sumB, sumB)}}).run, "c")
		require.NoError(t, err)
		onlySecond, err := ecrtag.LwqlAccessFingerprint(ctx, (&renders{outs: []string{renderOut(sumA, sumB), renderOut(sumB, sumB)}}).run, "d")
		require.NoError(t, err)

		assert.Equal(t, same, again)
		assert.NotEqual(t, same, changed)
		assert.NotEqual(t, same, onlySecond, "a change seen only with the second placeholder set was missed")
	})

	t.Run("fails when the render writes other files or no sums", func(t *testing.T) {
		for name, out := range map[string]string{
			"one file":    sumA + "  ./users.d/lwql-access.yaml\n",
			"extra file":  renderOut(sumA, sumB) + sumA + "  ./users.d/other.yaml\n",
			"a log line":  `{"level":"info"}` + "\n" + renderOut(sumA, sumB),
			"a short sum": renderOut("abc", sumB),
			"nothing":     "",
		} {
			_, err := ecrtag.LwqlAccessFingerprint(ctx, (&renders{outs: []string{out}}).run, "img")
			assert.Error(t, err, name)
		}
	})

	t.Run("fails when the image cannot render", func(t *testing.T) {
		_, err := ecrtag.LwqlAccessFingerprint(ctx, (&renders{err: errors.New("docker: exit status 1")}).run, "img")
		require.Error(t, err)
	})
}

func TestLwqlAccessFingerprintOf(t *testing.T) {
	fingerprint, ok := ecrtag.LwqlAccessFingerprintOf([]string{"git-1", "lwql-access-" + fpA + "-git-1", "lwql-access-" + fpA + "-git-2"})
	assert.True(t, ok)
	assert.Equal(t, fpA, fingerprint)

	_, ok = ecrtag.LwqlAccessFingerprintOf([]string{"git-1"})
	assert.False(t, ok, "no fingerprint")
	_, ok = ecrtag.LwqlAccessFingerprintOf([]string{"lwql-access-" + fpA + "-git-1", "lwql-access-" + fpB + "-git-1"})
	assert.False(t, ok, "two fingerprints")
	_, ok = ecrtag.LwqlAccessFingerprintOf([]string{"lwql-access-XYZ-git-1", "lwql-access-0123-git-1"})
	assert.False(t, ok, "malformed")
}

// @scenario "An app image records the fingerprint of the access model it renders"
// @scenario "A re-tagged app image keeps the fingerprint of the image it copies"
func TestLwqlAccessTag(t *testing.T) {
	ctx := context.Background()
	app := func(tag string) ecrtag.Ref { return ecrtag.Ref{Repository: "langwatch-app", Tag: tag} }
	render := func(fingerprint string) func(context.Context) (string, error) {
		return func(context.Context) (string, error) { return fingerprint, nil }
	}

	t.Run("a built index takes the fingerprint its per-arch manifest carries", func(t *testing.T) {
		reg := newRegistry().
			push("git-2", entry{digest: "sha256:index2", mediaType: index, body: "index-2"}).
			push("git-2-arm64", entry{digest: "sha256:arm2"}).
			push("lwql-access-"+fpA+"-git-2-arm64", entry{digest: "sha256:arm2"})

		fingerprint, err := ecrtag.LwqlAccessTag{Registry: reg, Ref: app("git-2"), Sources: []string{"git-2-arm64"}}.Write(ctx)

		require.NoError(t, err)
		assert.Equal(t, fpA, fingerprint)
		assert.Equal(t, []string{"lwql-access-" + fpA + "-git-2"}, reg.puts)
		assert.Equal(t, "index-2", reg.tags["lwql-access-"+fpA+"-git-2"].body, "the tag does not name the index")
	})

	t.Run("a re-tagged index takes the fingerprint of the index it copies", func(t *testing.T) {
		reg := newRegistry().
			push("git-1", entry{digest: "sha256:index1", mediaType: index}).
			push("lwql-access-"+fpA+"-git-1", entry{digest: "sha256:index1", mediaType: index}).
			push("git-3", entry{digest: "sha256:index3", mediaType: index, body: "index-3"})

		fingerprint, err := ecrtag.LwqlAccessTag{Registry: reg, Ref: app("git-3"), Sources: []string{"git-3-arm64", "git-1"}}.Write(ctx)

		require.NoError(t, err)
		assert.Equal(t, fpA, fingerprint)
		assert.Equal(t, []string{"lwql-access-" + fpA + "-git-3"}, reg.puts)
	})

	t.Run("a given fingerprint tags the image directly", func(t *testing.T) {
		reg := newRegistry().push("git-2-arm64", entry{body: "arm-2"})

		_, err := ecrtag.LwqlAccessTag{Registry: reg, Ref: app("git-2-arm64"), Render: render(fpB)}.Write(ctx)

		require.NoError(t, err)
		assert.Equal(t, []string{"lwql-access-" + fpB + "-git-2-arm64"}, reg.puts)
	})

	t.Run("an image that already carries one is left alone and never rendered", func(t *testing.T) {
		reg := newRegistry().
			push("git-2", entry{digest: "sha256:index2", mediaType: index}).
			push("lwql-access-"+fpA+"-git-2", entry{digest: "sha256:index2", mediaType: index})
		rendered := false
		renderOnce := func(context.Context) (string, error) { rendered = true; return fpB, nil }

		fingerprint, err := ecrtag.LwqlAccessTag{Registry: reg, Ref: app("git-2"), Render: renderOnce}.Write(ctx)

		require.NoError(t, err)
		assert.Equal(t, fpA, fingerprint)
		assert.Empty(t, reg.puts)
		assert.False(t, rendered, "rendered an image that already had a fingerprint")
	})

	t.Run("no fingerprint anywhere writes nothing and says so", func(t *testing.T) {
		reg := newRegistry().push("git-3", entry{mediaType: index}).push("git-1", entry{mediaType: index})

		_, err := ecrtag.LwqlAccessTag{Registry: reg, Ref: app("git-3"), Sources: []string{"git-3-arm64", "git-1"}}.Write(ctx)

		require.ErrorIs(t, err, ecrtag.ErrNoLwqlFingerprint)
		assert.Empty(t, reg.puts)
	})

	t.Run("a malformed given fingerprint is refused", func(t *testing.T) {
		reg := newRegistry().push("git-2", entry{})

		_, err := ecrtag.LwqlAccessTag{Registry: reg, Ref: app("git-2"), Render: render("nothex")}.Write(ctx)

		require.Error(t, err)
		assert.Empty(t, reg.puts)
	})
}

func TestImageTagsReadsOneImage(t *testing.T) {
	r := &recorder{out: `["git-1","lwql-access-` + fpA + `-git-1"]`}

	tags, err := cli(r).ImageTags(context.Background(), ref)

	require.NoError(t, err)
	assert.Equal(t, []string{"git-1", "lwql-access-" + fpA + "-git-1"}, tags)
	assert.Contains(t, strings.Join(r.calls[0].argv, " "), "--image-ids imageTag=t --query imageDetails[0].imageTags")

	_, err = cli(&recorder{err: errors.New("An error occurred (ImageNotFoundException)")}).ImageTags(context.Background(), ref)
	require.ErrorIs(t, err, ecrtag.ErrNotFound)
}
