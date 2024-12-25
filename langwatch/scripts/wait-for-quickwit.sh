attempts=0
max_attempts=20

status_code=0
while [ $status_code -ne 200 ] && [ $attempts -lt $max_attempts ]; do
  sleep 1
  ((attempts++))
  status_code=$(curl -s -o /dev/null -w "%{http_code}" \
    'http://localhost:7280/api/v1/_elastic' \
    -H 'accept: */*')
done

if [ $attempts -eq $max_attempts ]; then
  echo "Error: Timeout waiting for Quickwit to start after $max_attempts seconds"
  exit 1
fi
