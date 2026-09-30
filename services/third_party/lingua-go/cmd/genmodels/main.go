// Command genmodels converts upstream lingua-go v1.4.0's zipped protobuf
// models into models.bin: flat, sorted, fixed-width records the lingua
// package binary-searches in place. The output is byte-identical per input.
// It fetches upstream into the module cache from a temporary directory, so
// lingua-go never enters the repository's go.mod.
package main

import (
	"archive/zip"
	"bytes"
	"encoding/binary"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"maps"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"slices"

	"google.golang.org/protobuf/proto"

	"github.com/langwatch/langwatch/services/third_party/lingua-go/serialization"
)

const upstream = "github.com/pemistahl/lingua-go@v1.4.0"

var ngramNames = []string{"", "unigram", "bigram", "trigram", "quadrigram", "fivegram"}

func main() {
	out := flag.String("out", "models.bin", "where to write the models")
	src := flag.String("src", "", "upstream language-models directory (default: fetched into the module cache)")
	flag.Parse()
	if err := run(*src, *out); err != nil {
		fmt.Fprintln(os.Stderr, "genmodels:", err)
		os.Exit(1)
	}
}

func run(src, out string) error {
	if src == "" {
		dir, err := upstreamDir()
		if err != nil {
			return err
		}
		src = filepath.Join(dir, "language-models")
	}
	blob, count, err := buildBlob(src)
	if err != nil {
		return err
	}
	tmp := out + ".tmp"
	if err := os.WriteFile(tmp, blob, 0o644); err != nil {
		return err
	}
	if err := os.Rename(tmp, out); err != nil {
		return err
	}
	fmt.Printf("genmodels: %d models, %d bytes -> %s\n", count, len(blob), out)
	return nil
}

// upstreamDir downloads upstream into the module cache from an empty
// directory, outside any module or workspace, and returns its path.
func upstreamDir() (string, error) {
	tmp, err := os.MkdirTemp("", "genmodels")
	if err != nil {
		return "", err
	}
	defer func() { _ = os.RemoveAll(tmp) }()
	cmd := exec.Command("go", "mod", "download", "-json", upstream)
	cmd.Dir = tmp
	cmd.Env = append(os.Environ(), "GOWORK=off", "GOFLAGS=")
	cmd.Stderr = os.Stderr
	raw, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("go mod download %s: %w", upstream, err)
	}
	var module struct{ Dir, Error string }
	if err := json.Unmarshal(raw, &module); err != nil {
		return "", err
	}
	if module.Error != "" || module.Dir == "" {
		return "", fmt.Errorf("go mod download %s: %s", upstream, module.Error)
	}
	return module.Dir, nil
}

type modelFile struct {
	iso  string
	n    int
	blob []byte
}

// buildBlob lays out a header of (iso, ngram length, offset, size) entries,
// then each model, in directory order.
func buildBlob(src string) ([]byte, int, error) {
	models, err := readModels(src)
	if err != nil {
		return nil, 0, err
	}
	out := binary.LittleEndian.AppendUint32(nil, uint32(len(models)))
	offset := 4 + 12*len(models)
	for _, m := range models {
		out = append(out, m.iso[0], m.iso[1], byte(m.n), 0)
		out = binary.LittleEndian.AppendUint32(out, uint32(offset))
		out = binary.LittleEndian.AppendUint32(out, uint32(len(m.blob)))
		offset += len(m.blob)
	}
	for _, m := range models {
		out = append(out, m.blob...)
	}
	return out, len(models), nil
}

func readModels(src string) ([]modelFile, error) {
	isos, err := os.ReadDir(src)
	if err != nil {
		return nil, err
	}
	var models []modelFile
	for _, iso := range isos {
		for n := 1; n < len(ngramNames); n++ {
			path := filepath.Join(src, iso.Name(), ngramNames[n]+"s.pb.bin.zip")
			if _, err := os.Stat(path); err != nil {
				continue
			}
			blob, err := convert(path)
			if err != nil {
				return nil, fmt.Errorf("%s: %w", path, err)
			}
			models = append(models, modelFile{iso: iso.Name(), n: n, blob: blob})
		}
	}
	return models, nil
}

// convert writes one model as: probability count, the float64 probabilities,
// a group count, a (byte length, record count, offset) directory, then per
// byte length the sorted records of ngram bytes plus a uint32 probability index.
func convert(path string) ([]byte, error) {
	model, err := readModel(path)
	if err != nil {
		return nil, err
	}
	byLen := map[int][][]byte{}
	var probs []byte
	for i, set := range model.NgramSets {
		probs = binary.LittleEndian.AppendUint64(probs, math.Float64bits(set.Probability))
		for _, ngram := range set.Ngrams {
			rec := binary.LittleEndian.AppendUint32([]byte(ngram), uint32(i))
			byLen[len(ngram)] = append(byLen[len(ngram)], rec)
		}
	}
	lengths := slices.Sorted(maps.Keys(byLen))
	out := binary.LittleEndian.AppendUint32(nil, uint32(len(model.NgramSets)))
	out = append(out, probs...)
	out = append(out, byte(len(lengths)))
	dir := len(out)
	out = append(out, make([]byte, 9*len(lengths))...)
	for gi, l := range lengths {
		recs := byLen[l]
		slices.SortFunc(recs, bytes.Compare)
		entry := out[dir+9*gi:]
		entry[0] = byte(l)
		binary.LittleEndian.PutUint32(entry[1:], uint32(len(recs)))
		binary.LittleEndian.PutUint32(entry[5:], uint32(len(out)))
		for _, rec := range recs {
			out = append(out, rec...)
		}
	}
	return out, nil
}

func readModel(path string) (*serialization.SerializableLanguageModel, error) {
	zr, err := zip.OpenReader(path)
	if err != nil {
		return nil, err
	}
	defer func() { _ = zr.Close() }()
	f, err := zr.File[0].Open()
	if err != nil {
		return nil, err
	}
	defer func() { _ = f.Close() }()
	pb, err := io.ReadAll(f)
	if err != nil {
		return nil, err
	}
	var model serialization.SerializableLanguageModel
	return &model, proto.Unmarshal(pb, &model)
}
