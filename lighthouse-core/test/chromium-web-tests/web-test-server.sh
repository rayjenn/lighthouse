#!/usr/bin/env bash

##
# @license Copyright 2020 The Lighthouse Authors. All Rights Reserved.
# Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
# Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
##

set -euo pipefail

if ! type -P python3; then
  echo "python3 could not be found"
  exit 1
fi

# Get newest folder
latest_content_shell_dir=$(ls -t "$LH_ROOT/.tmp/chromium-web-tests/content-shells/" | head -n1)
export latest_content_shell="$LH_ROOT/.tmp/chromium-web-tests/content-shells/$latest_content_shell_dir"

# Run a very basic server on port 8000. Only thing we need is:
#   - /devtools -> the layout tests for devtools frontend
#   - /inspector-sources -> the generated resources from devtools
#   - CORS (Access-Control-Allow-Origin header)

ln -s "$DEVTOOLS_PATH/out/Default/gen/front_end" "$DEVTOOLS_PATH/test/webtests/http/tests/inspector-sources"

# Kill background jobs when script ends.
cleanup() {
  rm "$DEVTOOLS_PATH/test/webtests/http/tests/inspector-sources"
  kill ${SERVER_PID}
}
trap 'cleanup' EXIT

# Serve from devtools frontend webtests folder.
(npx http-server@0.12.3 "$DEVTOOLS_PATH/test/webtests/http/tests" -p 8000 --cors > /dev/null 2>&1) &
SERVER_PID=$!

echo "Waiting for server"
health_check_url='http://localhost:8000/inspector-sources/integration_test_runner.html?experiments=true&test=http://127.0.0.1:8000/devtools/lighthouse/lighthouse-view-trace-run.js'
until $(curl --output /dev/null --silent --head --fail $health_check_url); do
  printf '.'
  sleep 1
done
echo "Server is up"

# webtests sometimes error if results are already present.
rm -rf "$latest_content_shell/out/Release/layout-test-results"

# Add typ to python path. The regular method assumes there is a Chromium checkout.
export PYTHONPATH="${PYTHONPATH:-}:$BLINK_TOOLS_PATH/latest/third_party/typ"

# Don't quit if the python command fails.
set +e
# Print the python command.
set -x

python3 \
  "$BLINK_TOOLS_PATH/latest/third_party/blink/tools/run_web_tests.py" \
  --layout-tests-directory="$DEVTOOLS_PATH/test/webtests" \
  --build-directory="$latest_content_shell/out" \
  $*
status=$?

set +x
set -e

rm -rf "$LH_ROOT/.tmp/layout-test-results"
cp -r "$latest_content_shell/out/Release/layout-test-results" "$LH_ROOT/.tmp/layout-test-results"
cp "$DEVTOOLS_PATH/test/webtests/http/tests/devtools/lighthouse/"*-expected.txt "$LH_ROOT/third-party/chromium-webtests/webtests/http/tests/devtools/lighthouse"

exit $status
