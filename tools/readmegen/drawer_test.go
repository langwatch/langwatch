package readmegen

import (
	"reflect"
	"strings"
	"testing"
)

func drawerSources() []browserSource {
	filler := strings.Repeat("const value = useSomething(props); // unrelated browser code\n", 20000)
	return []browserSource{
		{module: "owner", text: filler + `openDrawer("traceDetails")`},
		{module: "calls", text: filler + `openTraceDrawer( 'traceDetails')`},
		{module: "links", text: filler + `href="?drawer.open=traceDetails&id=1"`},
		{module: "tokens", text: filler + `lends(TraceDetailsDrawer)`},
		{module: "prefix", text: filler + `MyTraceDetailsDrawerX; drawer.open=traceDetailsMore`},
		{module: "silent", text: filler},
	}
}

func TestDrawerOpenersFindsCallsLinksAndTokensOutsideTheOwner(t *testing.T) {
	g := &generator{sources: drawerSources()}
	drawer := &Drawer{Name: scalar("traceDetails"), Token: "TraceDetailsDrawer"}
	got := g.drawerOpeners("owner", drawer)
	if want := []string{"calls", "links", "tokens"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("openers = %v, want %v", got, want)
	}
}

func BenchmarkDrawerOpeners(b *testing.B) {
	g := &generator{sources: drawerSources()}
	drawer := &Drawer{Name: scalar("traceDetails"), Token: "TraceDetailsDrawer"}
	b.ReportAllocs()
	for b.Loop() {
		g.drawerOpeners("owner", drawer)
	}
}
