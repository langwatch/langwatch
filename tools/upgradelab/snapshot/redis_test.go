package snapshot

import (
	"bufio"
	"context"
	"net"
	"strings"
	"testing"
)

// A BUSY reply (a script holding Redis) is retried, not failed: SELECT answers BUSY once, then works.
func TestRedisRetriesBusy(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	go func() {
		conn, err := listener.Accept()
		if err != nil {
			return
		}
		defer conn.Close()
		reader, busy := bufio.NewReader(conn), true
		for {
			line, err := reader.ReadString('\n')
			if err != nil {
				return
			}
			if !strings.HasPrefix(line, "*") {
				continue
			}
			command := readCommand(reader, line)
			switch {
			case command == "SELECT" && busy:
				busy = false
				_, _ = conn.Write([]byte("-BUSY Redis is busy running a script.\r\n"))
			case command == "SELECT":
				_, _ = conn.Write([]byte("+OK\r\n"))
			default:
				_, _ = conn.Write([]byte(":3\r\n"))
			}
		}
	}()
	redis, err := NewRedisRESP("redis://" + listener.Addr().String() + "/0")
	if err != nil {
		t.Fatal(err)
	}
	size, err := redis.Size(context.Background())
	if err != nil || size != 3 {
		t.Fatalf("size %d, err %v: want 3 after one BUSY", size, err)
	}
}

// readCommand consumes one RESP array whose header is line and answers its first word.
func readCommand(reader *bufio.Reader, header string) string {
	count := 0
	for _, char := range strings.TrimSpace(header[1:]) {
		count = count*10 + int(char-'0')
	}
	first := ""
	for i := range count {
		_, _ = reader.ReadString('\n')
		word, _ := reader.ReadString('\n')
		if i == 0 {
			first = strings.TrimSpace(word)
		}
	}
	return first
}
