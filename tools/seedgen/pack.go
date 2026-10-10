package seedgen

import (
	"bytes"
	"fmt"
	"maps"
	"slices"
	"strconv"
	"time"
)

// Packer joins telemetry chunks of one project, kind and input (normal or Backdated) into requests up
// to the chunk bounds (design §5.2). Each chunk's bytes are spliced in unchanged, so every id and
// timestamp, and each cell's own hour, is what the chunker built. A packed request's ID is its first
// chunk's with "+<n>" for the n chunks after it; At is the first chunk's, the oldest in plan order.
type Packer struct {
	Now  time.Time // the clock Backdated reads
	open map[string]*pack
}

type pack struct {
	first        Action
	body         []byte // the open request: prefix and items, without the closing "]}"
	prefix       int    // len(`{"resourceSpans":[`)
	chunks, size int
}

// Add answers the request the chunk closes, if it no longer fits the open one, and holds the chunk.
func (pk *Packer) Add(chunk Action) ([]Action, error) {
	open := bytes.IndexByte(chunk.Input, '[')
	if open < 0 || !bytes.HasPrefix(chunk.Input, []byte(`{"resource`)) || !bytes.HasSuffix(chunk.Input, []byte("]}")) {
		return nil, fmt.Errorf("chunk %s is not one OTLP JSON export request", chunk.ID)
	}
	items := chunk.Input[open+1 : len(chunk.Input)-2]
	key := chunk.Project + "\x00" + chunk.Kind + "\x00" + strconv.FormatBool(Backdated(chunk, pk.Now))
	if pk.open == nil {
		pk.open = map[string]*pack{}
	}
	var closed []Action
	if p := pk.open[key]; p != nil {
		limit := MaxChunkRecords
		if chunk.Kind == KindTraceOTLP {
			limit = MaxChunkSpans
		}
		fits := p.size+chunk.Count <= limit && len(p.body)+1+len(items)+2 <= MaxChunkBytes &&
			bytes.Equal(p.body[:p.prefix], chunk.Input[:open+1])
		if fits {
			p.body = append(append(p.body, ','), items...)
			p.chunks, p.size = p.chunks+1, p.size+chunk.Count
			return nil, nil
		}
		closed = append(closed, p.request())
	}
	pk.open[key] = &pack{first: chunk, body: slices.Clone(chunk.Input[:len(chunk.Input)-2]), prefix: open + 1,
		chunks: 1, size: chunk.Count}
	return closed, nil
}

// Flush answers every open request, in key order, and empties the packer.
func (pk *Packer) Flush() []Action {
	var all []Action
	for _, key := range slices.Sorted(maps.Keys(pk.open)) {
		all = append(all, pk.open[key].request())
	}
	pk.open = nil
	return all
}

func (p *pack) request() Action {
	action := p.first
	if p.chunks > 1 {
		action.ID += "+" + strconv.Itoa(p.chunks-1)
		action.Key = action.ID
	}
	p.body = append(p.body, ']', '}')
	action.Input, action.Count = p.body, p.size
	return action
}
