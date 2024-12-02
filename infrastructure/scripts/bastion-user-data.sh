#!/bin/bash

# Erase the existing crontab
sudo crontab -r

sudo service crond restart

echo "Done"