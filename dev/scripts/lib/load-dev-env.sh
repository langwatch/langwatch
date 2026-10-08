# Loads a dotenv file into the environment, exporting every variable it sets.
# Sourced by `make service` / `make service-watch`. A name without a slash is
# read from the current directory: `.` in POSIX sh (dash on Debian and Ubuntu)
# looks such names up on PATH only.
load_dev_env() {
	case "$1" in
		/*) _load_dev_env_file=$1 ;;
		*) _load_dev_env_file=./$1 ;;
	esac
	set -a
	. "$_load_dev_env_file"
	set +a
	unset _load_dev_env_file
}
