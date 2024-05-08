#!/bin/bash

echo "*/4 * * * * root curl -X GET https://app.langwatch.ai/api/start_workers" | sudo tee -a /etc/crontab > /dev/null
echo "0 0 * * * root curl -X GET https://app.langwatch.ai/api/schedule_topic_clustering" | sudo tee -a /etc/crontab > /dev/null
echo "*/10 * * * * root curl -X GET 'https://app.langwatch.ai/api/demo/hotel_bot' -H 'X-Auth-Token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0aW1lc3RhbXAiOjE3MTQ2NTI1OTcyNzQsInJhbmQiOjAuMjY2NDg0MTU1MTIzMjA4OSwiaWF0IjoxNzE0NjUyNTk3fQ.1KlptkyzMmW5YA2qs--8gNXjQvQ9tnbmr8yjCSKPJME'" | sudo tee -a /etc/crontab > /dev/null

sudo service crond restart

echo "Done"