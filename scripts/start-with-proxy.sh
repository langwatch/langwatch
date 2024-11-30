#!/bin/sh

# Extract PostgreSQL host and port from DATABASE_URL
pg_host=$(echo $DATABASE_URL | sed -n "s/.*@\([^:]*\):.*/\1/p")
pg_port=$(echo $DATABASE_URL | sed -n "s/.*:\([0-9]*\)\/.*/\1/p")

# Extract Redis host and port from REDIS_URL
redis_host=$(echo $REDIS_URL | sed -n "s/.*@\([^:]*\):.*/\1/p")
redis_port=$(echo $REDIS_URL | sed -n "s/.*:\([0-9]*\).*/\1/p")

# Start proxies in background
socat TCP-LISTEN:5432,fork TCP:$pg_host:$pg_port &
socat TCP-LISTEN:6379,fork TCP:$redis_host:$redis_port &

# Replace hosts in connection strings with localhost
export DATABASE_URL=$(echo $DATABASE_URL | sed "s/@[^/]*\//@localhost:5432\//" )
export REDIS_URL=$(echo $REDIS_URL | sed "s/@[^/]*/@localhost:6379/" )

# Start the application
exec npm start