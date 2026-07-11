package dashboard

import (
	"errors"
	"fmt"
	"net/http"
	"os"
	"time"
)

// StartEcho stands a tiny echo server up on each port — the verification stand-in
// for the real apps, so `haven up`'s full resolve -> alias -> registry ->
// dashboard -> routing chain can be exercised without booting the databases.
func StartEcho(ports []int) {
	for _, p := range ports {
		port := p
		mux := http.NewServeMux()
		mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
			fmt.Fprintf(w, "haven-stub port=%d host=%s path=%s\n", port, r.Host, r.URL.Path)
		})
		srv := &http.Server{Addr: fmt.Sprintf("127.0.0.1:%d", port), Handler: mux, ReadHeaderTimeout: 5 * time.Second}
		go func() {
			// A silent failure here (e.g. port already bound) looks identical to a
			// healthy stub from the caller's side, so surface it instead of swallowing it.
			if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
				fmt.Fprintf(os.Stderr, "haven-stub: port=%d: %v\n", port, err)
			}
		}()
	}
}
