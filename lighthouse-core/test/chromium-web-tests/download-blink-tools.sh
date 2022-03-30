#!/usr/bin/env bash

set -euo pipefail

##
# @license Copyright 2020 The Lighthouse Authors. All Rights Reserved.
# Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
# Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
##

# Download blink tools for run_web_tests.py.

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# https://chromium.googlesource.com/chromium/src/
commit_chromium="e1c3b88f73fcbff831485c0ca37f877bd22b7a02"
# https://chromium.googlesource.com/catapult/
commit_catapult="c2b4e773a8d77586ddea18b1962a3e02d19e682f"

VERSIONED_DIR="$BLINK_TOOLS_PATH/$commit_chromium$commit_catapult"

if ! type -P wget; then
  echo "wget could not be found"
  exit 1
fi
if ! type -P tar; then
  echo "tar could not be found"
  exit 1
fi
if ! type -P git; then
  echo "git could not be found"
  exit 1
fi

if [ -e "$VERSIONED_DIR" ]; then
  echo "cached blink tools found"
else
  mkdir -p "$VERSIONED_DIR/third_party/blink/tools"
  rm "$BLINK_TOOLS_PATH/latest" || true
  ln -s "$VERSIONED_DIR" "$BLINK_TOOLS_PATH/latest"

  wget "https://chromium.googlesource.com/chromium/src/+archive/$commit_chromium/third_party/blink/tools.tar.gz" --no-check-certificate -q -O blinktools.tar.gz
  tar -xf blinktools.tar.gz -C "$VERSIONED_DIR/third_party/blink/tools"
  rm blinktools.tar.gz

  # Just need this for the results.html template.
  mkdir -p "$VERSIONED_DIR/third_party/blink/web_tests/fast/harness"
  wget "https://chromium.googlesource.com/chromium/src/+archive/$commit_chromium/third_party/blink/web_tests/fast/harness.tar.gz" --no-check-certificate -q -O harness.tar.gz
  tar -xf harness.tar.gz -C "$VERSIONED_DIR/third_party/blink/web_tests/fast/harness"
  rm harness.tar.gz

  mkdir -p "$VERSIONED_DIR/third_party/typ"
  wget "https://chromium.googlesource.com/catapult/+archive/$commit_catapult/third_party/typ.tar.gz" --no-check-certificate -q -O typ.tar.gz
  tar -xf typ.tar.gz -C "$VERSIONED_DIR/third_party/typ"
  rm typ.tar.gz

  cd "$VERSIONED_DIR"
  git init
  echo "*.pyc" > .gitignore
  git add .
  git commit -m baseline
  patch -p1 < "$SCRIPT_DIR/blink-tools.patch"
fi
