#!/bin/bash

echo "*/4 * * * * root curl -X GET https://app.langwatch.ai/api/start_workers" | sudo tee -a /etc/crontab > /dev/null
echo "0 0 * * * root curl -X GET https://app.langwatch.ai/api/schedule_topic_clustering" | sudo tee -a /etc/crontab > /dev/null

sudo service crond restart

echo "Done"