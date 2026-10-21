// Command catalogue writes evaluators.generated.ts, unformatted, from the Go
// evaluator definitions. `go generate ./nlpgo/modules/evaluators/transport/catalogue`
// in services/ runs it and then oxfmt.
package main

import (
	"flag"
	"log"
	"os"

	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/rules"
	"github.com/langwatch/langwatch/services/nlpgo/modules/evaluators/transport/catalogue"
)

func main() {
	out := flag.String("out", "", "the path of evaluators.generated.ts to write")
	flag.Parse()
	if *out == "" {
		log.Fatal("catalogue: -out is required")
	}
	if err := os.WriteFile(*out, catalogue.Render(rules.Definitions()), 0o600); err != nil {
		log.Fatal(err)
	}
}
