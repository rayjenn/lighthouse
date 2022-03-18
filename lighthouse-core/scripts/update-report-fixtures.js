/**
 * @license Copyright 2018 The Lighthouse Authors. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License. You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software distributed under the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the License for the specific language governing permissions and limitations under the License.
 */
'use strict';

import * as cli from '../../lighthouse-cli/run.js';
import * as cliFlags from '../../lighthouse-cli/cli-flags.js';
import assetSaver from '../lib/asset-saver.js';
import {server} from '../../lighthouse-cli/test/fixtures/static-server.js';
import budgetedConfig from '../test/results/sample-config.js';

const artifactPath = 'lighthouse-core/test/results/artifacts';
// All artifacts must have resources from a consistent port, to ensure reproducibility.
// https://github.com/GoogleChrome/lighthouse/issues/11776
const MAGIC_SERVER_PORT = 10200;

/**
 * Update the report artifacts.
 * If artifactNames is nonempty, only those artifacts will be updated.
 * @param {Array<keyof LH.Artifacts>} artifactNames
 */
async function update(artifactNames) {
  await server.listen(MAGIC_SERVER_PORT, 'localhost');

  const oldArtifacts = assetSaver.loadArtifacts(artifactPath);

  const url = `http://localhost:${MAGIC_SERVER_PORT}/dobetterweb/dbw_tester.html`;
  const rawFlags = [
    `--gather-mode=${artifactPath}`,
    url,
  ].join(' ');
  const flags = cliFlags.getFlags(rawFlags);
  await cli.runLighthouse(url, flags, budgetedConfig);
  await server.close();

  const newArtifacts = assetSaver.loadArtifacts(artifactPath);

  assetSaver.normalizeTimingEntries(newArtifacts.Timing);

  if (artifactNames.length === 0) {
    await assetSaver.saveArtifacts(newArtifacts, artifactPath);
    return;
  }

  // Revert everything except these artifacts.
  const artifactsToKeep = {...oldArtifacts};
  for (const artifactName of artifactNames) {
    if (!(artifactName in newArtifacts) && !(artifactName in oldArtifacts)) {
      throw Error('Unknown artifact name: ' + artifactName);
    }

    // @ts-expect-error tsc can't yet express that artifactName is only a single type in each iteration, not a union of types.
    artifactsToKeep[artifactName] = newArtifacts[artifactName];
  }

  await assetSaver.saveArtifacts(artifactsToKeep, artifactPath);
}

update(/** @type {Array<keyof LH.Artifacts>} */ (process.argv.slice(2)));
