#!/usr/bin/env bash

set -e

ALB_DNS=$(terraform output -raw alb_dns_name)

BASE_URL="http://${ALB_DNS}"

echo
echo "=============================================="
echo "AWS WAF SQLi_BODY Count + Label Demo"
echo "=============================================="
echo
echo "ALB:"
echo "${BASE_URL}"
echo

echo "=============================================="
echo "TEST 1: Normal request"
echo "Expected: 200"
echo "=============================================="
echo

curl -i \
  -X POST \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "username=test-user" \
  --data-urlencode "password=normal-password-123" \
  "${BASE_URL}/login"

echo
echo
echo "=============================================="
echo "TEST 2: SQLi-like request to /login"
echo
echo "Expected:"
echo "SQLi_BODY -> Count"
echo "Label attached"
echo "Custom Block Rule -> NOT matched"
echo "Default Action -> Allow"
echo "HTTP -> 200"
echo "=============================================="
echo

curl -i \
  -X POST \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "username=test-user" \
  --data-urlencode "password=' OR 1=1 --" \
  "${BASE_URL}/login"

echo
echo
echo "=============================================="
echo "TEST 3: Same SQLi-like request to /normal"
echo
echo "Expected:"
echo "SQLi_BODY -> Count"
echo "Label attached"
echo "Custom Block Rule -> Match"
echo "HTTP -> 403"
echo "=============================================="
echo

curl -i \
  -X POST \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "username=test-user" \
  --data-urlencode "password=' OR 1=1 --" \
  "${BASE_URL}/normal"

echo
echo
echo "=============================================="
echo "Test completed"
echo "=============================================="