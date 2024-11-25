#!/bin/sh

set -eo pipefail

curl -L https://install.quickwit.io | sh

mv ./quickwit-v* ./quickwit