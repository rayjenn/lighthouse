#!/usr/bin/env bash

##
# @license Copyright 2022 The Lighthouse Authors. All Rights Reserved.
# Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
# Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
##

set -e

PWD="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
LH_ROOT="$PWD/../.."
BASELINE_RESULT_PATH="$LH_ROOT/lighthouse-core/test/fixtures/fraggle-rock/reports/sample-flow-result.json"
TMP_PATH="$LH_ROOT/.tmp"
FRESH_RESULT_PATH="$TMP_PATH/fresh_flow_result.json"

purple='\033[1;35m'
red='\033[1;31m'
green='\033[1;32m'
colorText() {
  printf "\\n$2$1%b\\n" '\033[0m'
}

colorText "Generating fresh flow result" "$purple"
yarn update:flow-sample-json --output-path "$TMP_PATH/fresh_flow_result.json"

colorText "Diff'ing baseline flow result against the fresh flow result" "$purple"

set +e
git --no-pager diff --color=always --no-index "$BASELINE_RESULT_PATH" "$FRESH_RESULT_PATH"
retVal=$?
set -e

if [ $retVal -eq 0 ]; then
  colorText "✅  PASS. No change in the flow result." "$green"
else
  colorText "❌  FAIL. Flow result has changed." "$red"
  echo "Run \`yarn update:flow-sample-json\` to rebaseline the flow result."
fi
exit $retVal
