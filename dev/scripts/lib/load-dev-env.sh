# Loads a dotenv file into the environment, exporting every variable it sets.
# Sourced by `make service` / `make service-watch`. A name without a slash is
# read from the current directory: `.` in POSIX sh (dash on Debian and Ubuntu)
# looks such names up on PATH only. Returns the status of loading the file.
load_dev_env() {
	case "$1" in
		/*) _load_dev_env_file=$1 ;;
		*) _load_dev_env_file=./$1 ;;
	esac
	set -a
	. "$_load_dev_env_file"
	# The status goes in $1, not a variable: under set -a it would be exported.
	set -- "$?"
	set +a
	unset _load_dev_env_file
	return "$1"
}
